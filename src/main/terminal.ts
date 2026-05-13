import { spawn, type IPty } from 'node-pty'
import { EventEmitter } from 'events'
import { platform } from 'os'
import { delimiter, join, dirname } from 'path'
import { getShellEnvFromDb } from './shell-env'
import { detectWorkspacePythonEnv, type PythonEnvInfo } from './python-env'

export interface TerminalSession {
  id: string
  shell: string
  cwd: string
  pty: IPty
}

// ── Windows path conversion helpers ──

function toWslPath(winPath: string): string {
  // C:\Users\name → /mnt/c/Users/name
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/mnt/$1').toLowerCase()
}

function toGitBashPath(winPath: string): string {
  // C:\Users\name → /c/Users/name
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1')
}

function convertWindowsPathForShell(winPath: string, shellType: 'wsl' | 'gitbash' | 'native'): string {
  if (shellType === 'wsl') return toWslPath(winPath)
  if (shellType === 'gitbash') return toGitBashPath(winPath)
  return winPath
}

function convertPathListForShell(
  pathList: string,
  shellType: 'wsl' | 'gitbash' | 'native',
): string {
  const sep = process.platform === 'win32' ? ';' : ':'
  const parts = pathList.split(sep)
  const converted = parts.map(p => convertWindowsPathForShell(p, shellType))
  return shellType === 'native' ? converted.join(';') : converted.join(':')
}

function getShellType(shellPath: string): 'wsl' | 'gitbash' | 'native' {
  const lower = shellPath.toLowerCase()
  if (lower.includes('wsl')) return 'wsl'
  if (lower.includes('git') || lower.includes('bash.exe')) {
    // Check if it's Git Bash
    const env = getShellEnvFromDb()
    if (env?.type === 'gitbash') return 'gitbash'
    // Also detect by path
    if (lower.includes('git\\bin\\bash') || lower.includes('git/bin/bash')) return 'gitbash'
  }
  return 'native'
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()
  private idCounter = 0

  create(
    shell?: string,
    cwd?: string,
    pythonEnv?: PythonEnvInfo | null,
  ): TerminalSession {
    const id = `term-${++this.idCounter}`
    const actualShell = shell || this.getDefaultShell()
    const shellType = getShellType(actualShell)
    const actualCwd = cwd || process.cwd()

    // Convert cwd for WSL/Git Bash on Windows
    let spawnCwd = actualCwd
    if (process.platform === 'win32' && shellType !== 'native') {
      spawnCwd = convertWindowsPathForShell(actualCwd, shellType)
    }

    // Build env with Python venv/conda PATH injection
    const env = { ...process.env as { [key: string]: string } }
    if (pythonEnv) {
      if ((pythonEnv.type === 'uv-agent' || pythonEnv.type === 'user-venv') && pythonEnv.venvPath) {
        const binDir = process.platform === 'win32'
          ? join(pythonEnv.venvPath, 'Scripts')
          : join(pythonEnv.venvPath, 'bin')
        if (env.PATH) {
          if (process.platform === 'win32' && shellType !== 'native') {
            // Convert Windows PATH to Unix format for WSL/Git Bash
            env.PATH = convertPathListForShell(binDir + ';' + env.PATH, shellType)
          } else {
            env.PATH = binDir + delimiter + env.PATH
          }
        } else {
          env.PATH = binDir
        }
        env.VIRTUAL_ENV = pythonEnv.venvPath
      } else if (pythonEnv.type === 'conda' && pythonEnv.pythonPath) {
        const envRoot = dirname(dirname(pythonEnv.pythonPath))
        const binDir = process.platform === 'win32'
          ? join(envRoot, 'Scripts')
          : join(envRoot, 'bin')
        if (env.PATH) {
          if (process.platform === 'win32' && shellType !== 'native') {
            env.PATH = convertPathListForShell(binDir + ';' + env.PATH, shellType)
          } else {
            env.PATH = binDir + delimiter + env.PATH
          }
        } else {
          env.PATH = binDir
        }
        env.CONDA_PREFIX = envRoot
        env.CONDA_DEFAULT_ENV = pythonEnv.condaEnvName || 'base'
      }
    }

    const pty = spawn(actualShell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: spawnCwd,
      env,
    })

    const session: TerminalSession = { id, shell: actualShell, cwd: actualCwd, pty }
    this.sessions.set(id, session)

    pty.onData((data) => this.emit('data', { id, data }))
    pty.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode })
      this.sessions.delete(id)
    })

    return session
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill()
    this.sessions.delete(id)
  }

  private getDefaultShell(): string {
    // Check saved preference first
    const saved = getTerminalDefaultShell()
    if (saved) return saved

    if (platform() === 'win32') {
      const env = getShellEnvFromDb()
      if (env?.type === 'gitbash') return env.path || 'C:\\Program Files\\Git\\bin\\bash.exe'
      if (env?.type === 'wsl') return 'wsl.exe'
      return process.env.COMSPEC || 'cmd.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }
}

function getDb() {
  try {
    return (global as any).__db as { getSetting?: (key: string) => string | null; setSetting?: (key: string, value: string) => void } | undefined
  } catch {
    return undefined
  }
}

export function getTerminalDefaultShell(): string | null {
  const db = getDb()
  if (!db?.getSetting) return null
  return db.getSetting('terminalDefaultShell') || null
}

export function saveTerminalDefaultShell(shell: string): void {
  const db = getDb()
  if (!db?.setSetting) return
  db.setSetting('terminalDefaultShell', shell)
}
