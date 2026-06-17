/**
 * Shell Environment Detection & Management for Windows
 *
 * Detects Git Bash / WSL / native cmd-powershell and lets the user choose.
 * Stores preference in DB settings.
 */
import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export type ShellEnvType = 'cmd' | 'powershell' | 'gitbash' | 'wsl' | 'bash' | 'zsh' | 'sh'
  // Back-compat: 'native' was the old "cmd/powershell" lump; normalized to 'cmd'.
  | 'native'

export interface ShellEnvConfig {
  type: ShellEnvType
  path?: string // for gitbash: path to bash.exe
}

/** Shells whose syntax is bash-like (so Unix-style redirects/builtins apply). */
export function isBashLikeShell(type: ShellEnvType): boolean {
  return type === 'gitbash' || type === 'wsl' || type === 'bash' || type === 'zsh' || type === 'sh'
}

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
]

function findGitBashInPath(): string | null {
  try {
    const result = execSync('where bash.exe', { encoding: 'utf-8', timeout: 3000, env: process.env }).trim().split('\n')[0]
    if (result && existsSync(result.trim())) return result.trim()
  } catch {}
  return null
}

function findGitBash(): string | null {
  for (const p of GIT_BASH_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return findGitBashInPath()
}

function detectWsl(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('wsl.exe --version', { encoding: 'utf-8', timeout: 3000, env: process.env })
    return true
  } catch {
    return false
  }
}

export function autoDetectShellEnv(): { gitbash?: string; wsl: boolean } {
  return {
    gitbash: findGitBash() || undefined,
    wsl: detectWsl(),
  }
}

export function getShellEnvFromDb(): ShellEnvConfig | null {
  try {
    const db = (global as any).__db as { getSetting?: (key: string) => string | null } | undefined
    if (!db?.getSetting) return null
    const raw = db.getSetting('shellEnv')
    if (!raw) return null
    return JSON.parse(raw) as ShellEnvConfig
  } catch {
    return null
  }
}

export function saveShellEnvToDb(config: ShellEnvConfig): void {
  try {
    const db = (global as any).__db as { setSetting?: (key: string, value: string) => void } | undefined
    if (!db?.setSetting) return
    db.setSetting('shellEnv', JSON.stringify(config))
  } catch {}
}

/**
 * Convert a Windows path to a WSL path.
 * C:\foo\bar → /mnt/c/foo/bar
 */
export function windowsToWslPath(winPath: string): string {
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/mnt/$1').toLowerCase()
}

export interface ResolvedShellCommand {
  /** Executable to spawn (shell binary). */
  file: string
  /** Arguments — the raw command is passed as a single argument, never re-parsed. */
  args: string[]
  /** Working directory for spawn. */
  cwd: string
  /** Whether the shell uses bash-like syntax (affects redirect rewriting). */
  bashLike: boolean
}

/**
 * Pick a sensible default shell when the user hasn't configured one.
 * Windows → cmd; Unix → $SHELL || /bin/bash || /bin/sh.
 */
export function resolveDefaultShell(platform: NodeJS.Platform = process.platform): ShellEnvConfig {
  if (platform === 'win32') return { type: 'cmd' }
  const envShell = process.env.SHELL
  if (envShell && existsSync(envShell)) {
    if (envShell.includes('zsh')) return { type: 'zsh', path: envShell }
    if (envShell.includes('bash')) return { type: 'bash', path: envShell }
    return { type: 'sh', path: envShell }
  }
  if (existsSync('/bin/bash')) return { type: 'bash', path: '/bin/bash' }
  return { type: 'sh', path: '/bin/sh' }
}

/**
 * Build an explicit `spawn(file, args)` invocation for a command across shells.
 * Passing the command as a single `-c`/`-Command`/`/c` argument (with shell:false)
 * avoids the fragile double-shell quoting of the old `shell:true` approach.
 */
export function buildShellCommand(
  rawCommand: string,
  cwd: string,
  shellEnv?: ShellEnvConfig | null,
  platform: NodeJS.Platform = process.platform,
): ResolvedShellCommand {
  // Normalize legacy 'native' → cmd, and fall back to a platform default.
  let cfg = shellEnv ?? resolveDefaultShell(platform)
  if (cfg.type === 'native') cfg = { type: 'cmd' }
  const bashLike = isBashLikeShell(cfg.type)

  switch (cfg.type) {
    case 'powershell':
      return { file: 'powershell.exe', args: ['-NoProfile', '-Command', rawCommand], cwd, bashLike: false }
    case 'gitbash':
      return { file: cfg.path || 'bash.exe', args: ['-c', rawCommand], cwd, bashLike: true }
    case 'wsl': {
      const wslCwd = windowsToWslPath(cwd)
      return { file: 'wsl.exe', args: ['bash', '-c', `cd "${wslCwd}" && ${rawCommand}`], cwd, bashLike: true }
    }
    case 'bash':
    case 'zsh':
    case 'sh':
      return { file: cfg.path || (cfg.type === 'sh' ? '/bin/sh' : `/bin/${cfg.type}`), args: ['-c', rawCommand], cwd, bashLike: true }
    case 'cmd':
    default:
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', rawCommand], cwd, bashLike: false }
  }
}

/** @deprecated kept for callers expecting the old string form. */
export function buildWindowsShellCommand(
  rawCommand: string,
  cwd: string,
  shellEnv: ShellEnvConfig,
): { command: string; options: { cwd: string; shell?: boolean | string } } {
  const resolved = buildShellCommand(rawCommand, cwd, shellEnv, 'win32')
  return { command: `${resolved.file} ${resolved.args.join(' ')}`, options: { cwd } }
}

/**
 * Check whether shell env setup has been completed.
 */
export function hasCompletedShellEnvSetup(): boolean {
  return getShellEnvFromDb() !== null
}
