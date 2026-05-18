import { resolve, relative, basename, sep } from 'path'
import { realpathSync } from 'fs'

const ILLEGAL_PATH_CHARS = /[<>"|?*\x00-\x1f]/
const SUSPICIOUS_PATTERNS = [
  /require\s*\(/,
  /import\s+/,
  /const\s+/,
  /let\s+/,
  /var\s+/,
  /function\s+/,
  /=>\s*\{/,
]

function isSuspiciousPath(rawPath: string): boolean {
  const name = basename(rawPath)
  if (SUSPICIOUS_PATTERNS.some((re) => re.test(name))) return true
  if (name.includes('\n') || name.includes('\r')) return true
  if (name.length > 200) return true
  return false
}

/**
 * Robust path containment check that handles Windows cross-drive traversal
 * and symbolic links.
 */
function isPathContained(target: string, root: string): boolean {
  const resolvedTarget = resolve(target)
  const resolvedRoot = resolve(root)

  // Windows: different drives = definitely outside
  if (process.platform === 'win32') {
    const tDrive = resolvedTarget.match(/^([A-Za-z]:)/)?.[1]
    const rDrive = resolvedRoot.match(/^([A-Za-z]:)/)?.[1]
    if (tDrive && rDrive && tDrive.toLowerCase() !== rDrive.toLowerCase()) {
      return false
    }
  }

  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)
}

/**
 * 确保路径不逃出 workspace，且路径本身合法。
 * 解析符号链接以防止通过 symlink 的目录遍历。
 */
export function safePath(rawPath: string, workspacePath: string): string {
  const name = basename(rawPath)
  if (ILLEGAL_PATH_CHARS.test(name)) {
    throw new Error(`Path contains illegal characters: ${rawPath}`)
  }
  if (isSuspiciousPath(rawPath)) {
    throw new Error(`Path looks like a code snippet, not a file path: ${rawPath}`)
  }

  const resolved = resolve(workspacePath, rawPath)

  // Resolve symlinks on the parent directory chain to prevent symlink escapes.
  // If the resolved path itself does not exist yet (write operations), we check
  // the nearest existing ancestor.
  let realTarget: string
  try {
    realTarget = realpathSync(resolved)
  } catch {
    // Path does not exist yet — walk up to the first existing directory and
    // resolve that, then append the remainder.
    realTarget = resolved
    let current = resolved
    const missingParts: string[] = []
    while (current !== resolve(current, '..')) {
      try {
        const real = realpathSync(current)
        realTarget = resolve(real, ...missingParts.reverse())
        break
      } catch {
        missingParts.push(basename(current))
        current = resolve(current, '..')
      }
    }
  }

  const realWorkspace = (() => {
    try { return realpathSync(workspacePath) } catch { return resolve(workspacePath) }
  })()

  if (!isPathContained(realTarget, realWorkspace)) {
    throw new Error(`Path escapes workspace: ${rawPath}`)
  }
  return resolved
}

/**
 * 检查命令是否危险。
 * 采用 deny-list + heuristic，覆盖常见的破坏性模式。
 */
export function isDangerousCommand(command: string): boolean {
  const dangerous = [
    // rm -rf variants
    /rm\s+(-[rf]+\s+)+[/]/,
    /rm\s+(-[rf]+\s+)+~[/]/,
    /rm\s+(-[rf]+\s+)+\$HOME/,
    // fork bomb
    /:\(\)\{\s*:\|\:\&\s*\};/,
    // pipe to shell
    /curl\s+.*\|\s*(sh|bash|zsh)/,
    /wget\s+.*\|\s*(sh|bash|zsh)/,
    /fetch\s+.*\|\s*(sh|bash|zsh)/,
    // sudo / privilege escalation
    /sudo\s+/,
    /su\s+-/,
    // dangerous chmod
    /chmod\s+[-+]?[0-7]*777/,
    // disk/format operations
    /\bmkfs\./,
    /\b(dd|fdisk|parted)\s+/,
    // system modification
    /\b(reboot|shutdown|halt|poweroff)\s/,
    // eval / exec of untrusted input
    /\beval\s*\(/,
    /\bexec\s+\$/,
    // python one-liner executing system commands
    /python\s+(-c|--command)\s+.*\bos\.(system|popen|exec)/,
    // node one-liner executing system commands
    /node\s+(-e|--eval)\s+.*\b(child_process|exec|spawn)/,
    // redirect to system files
    />\s*[/]etc[/]\w+/,
    />\s*[/]sys[/]\w+/,
    // backtick / $() command substitution (heuristic)
    /\$\(.*\b(rm|mkfs|dd|curl|wget)\b.*\)/,
    /`.*\b(rm|mkfs|dd|curl|wget)\b.*`/,
  ]
  return dangerous.some((re) => re.test(command))
}
