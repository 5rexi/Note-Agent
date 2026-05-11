/**
 * Shell Environment Detection & Management for Windows
 *
 * Detects Git Bash / WSL / native cmd-powershell and lets the user choose.
 * Stores preference in DB settings.
 */
import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export type ShellEnvType = 'gitbash' | 'wsl' | 'native'

export interface ShellEnvConfig {
  type: ShellEnvType
  path?: string // for gitbash: path to bash.exe
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

/**
 * Build the command invocation based on shell env.
 * Returns { command, options } for execSync / spawn.
 */
export function buildWindowsShellCommand(
  rawCommand: string,
  cwd: string,
  shellEnv: ShellEnvConfig,
): { command: string; options: { cwd: string; shell?: boolean | string } } {
  if (shellEnv.type === 'gitbash' && shellEnv.path) {
    // Git Bash: "C:\Program Files\Git\bin\bash.exe" -c "command"
    return {
      command: `"${shellEnv.path}" -c "${rawCommand.replace(/"/g, '\\"')}"`,
      options: { cwd },
    }
  }

  if (shellEnv.type === 'wsl') {
    // WSL: wsl.exe bash -c "cd /mnt/c/... && command"
    const wslCwd = windowsToWslPath(cwd)
    const escaped = rawCommand.replace(/"/g, '\\"')
    return {
      command: `wsl.exe bash -c "cd \\"${wslCwd}\\" && ${escaped}"`,
      options: { cwd },
    }
  }

  // Native cmd/powershell
  return {
    command: rawCommand,
    options: { cwd, shell: true },
  }
}

/**
 * Check whether shell env setup has been completed.
 */
export function hasCompletedShellEnvSetup(): boolean {
  return getShellEnvFromDb() !== null
}
