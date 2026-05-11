import { resolve, relative, basename } from 'path'

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
 * 确保路径不逃出 workspace，且路径本身合法
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
  const rel = relative(workspacePath, resolved)
  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`Path escapes workspace: ${rawPath}`)
  }
  return resolved
}

/**
 * 检查命令是否危险
 */
export function isDangerousCommand(command: string): boolean {
  const dangerous = [
    /rm\s+-rf\s+\//,
    /:\(\)\{\s*:\|\:\&\s*\};/, // fork bomb
    /curl.+\|\s*sh/,
    /wget.+\|\s*sh/,
    /sudo\s+/,
    /chmod\s+777/,
  ]
  return dangerous.some((re) => re.test(command))
}
