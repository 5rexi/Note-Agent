/**
 * Python / uv / conda Virtual Environment Management
 *
 * Design:
 * - .note_agent/venv: Agent-only venv (auto-created, used by agent tools)
 * - User envs: User-created venvs/conda envs/system python (user selects per workspace)
 * - Terminal & LSP use user-selected env
 * - Agent tools always use .note_agent/venv
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'
import https from 'https'
import { createWriteStream } from 'fs'

const UV_VERSION = '0.6.25'
const UV_DIR = join(homedir(), '.note_agent', 'uv')

// ── uv ──

function getUvPlatformBinary(): string {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32') {
    return arch === 'arm64' ? 'uv-aarch64-pc-windows-msvc.exe' : 'uv-x86_64-pc-windows-msvc.exe'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'uv-aarch64-apple-darwin' : 'uv-x86_64-apple-darwin'
  }
  // Linux
  return arch === 'arm64' ? 'uv-aarch64-unknown-linux-gnu' : 'uv-x86_64-unknown-linux-gnu'
}

function getUvDownloadUrl(): string {
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`
  const binary = getUvPlatformBinary()
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  return `${base}/${binary}.${ext}`
}

function getUvPath(): string {
  const binary = getUvPlatformBinary()
  return join(UV_DIR, process.platform === 'win32' ? binary : 'uv')
}

export function isUvInstalled(): boolean {
  try {
    execSync('uv --version', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' })
    return true
  } catch {}
  return existsSync(getUvPath())
}

export async function ensureUvInstalled(): Promise<string | null> {
  try {
    execSync('uv --version', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' })
    return 'uv'
  } catch {}

  const localPath = getUvPath()
  if (existsSync(localPath)) return localPath

  // Download uv
  const url = getUvDownloadUrl()
  mkdirSync(UV_DIR, { recursive: true })
  const archivePath = join(UV_DIR, 'download.' + (process.platform === 'win32' ? 'zip' : 'tar.gz'))

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(archivePath)
    https.get(url, { headers: { 'User-Agent': 'note-agent' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const location = res.headers.location
        if (!location) { reject(new Error('Redirect without location')); return }
        https.get(location, { headers: { 'User-Agent': 'note-agent' } }, (res2) => {
          res2.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', reject)
  })

  // Extract
  if (process.platform === 'win32') {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(archivePath)
    zip.extractAllTo(UV_DIR, true)
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${UV_DIR}"`, { timeout: 30000 })
  }

  // Cleanup
  try { require('fs').unlinkSync(archivePath) } catch {}

  return existsSync(localPath) ? localPath : null
}

// ── Agent-only venv (.note_agent/venv) ──

export function getAgentVenvPath(workspacePath: string): string {
  return join(workspacePath, '.note_agent', 'venv')
}

export function getAgentPythonPath(workspacePath: string): string | null {
  const venv = getAgentVenvPath(workspacePath)
  const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(python) ? python : null
}

export async function ensureAgentVenv(workspacePath: string): Promise<string | null> {
  const existing = getAgentPythonPath(workspacePath)
  if (existing) return existing

  const uv = await ensureUvInstalled()
  if (!uv) return null

  const venvPath = getAgentVenvPath(workspacePath)
  mkdirSync(venvPath, { recursive: true })

  try {
    execSync(`"${uv}" venv "${venvPath}"`, { encoding: 'utf-8', timeout: 60000, env: process.env })
  } catch {
    return null
  }

  return getAgentPythonPath(workspacePath)
}

/**
 * Rewrite a command to use the AGENT venv python (for agent tools only).
 */
export function rewritePythonCommand(command: string, workspacePath: string): string {
  const python = getAgentPythonPath(workspacePath)
  if (!python) return command
  return command.replace(/^python3?\b/, `"${python}"`)
}

// ── conda ──

const COMMON_CONDA_PATHS: string[] = []

function buildCommonCondaPaths(): string[] {
  if (COMMON_CONDA_PATHS.length > 0) return COMMON_CONDA_PATHS
  const home = homedir()
  const candidates: string[] = []

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    candidates.push(
      join('C:', 'ProgramData', 'miniconda3', 'Scripts', 'conda.exe'),
      join('C:', 'ProgramData', 'anaconda3', 'Scripts', 'conda.exe'),
      join(home, 'miniconda3', 'Scripts', 'conda.exe'),
      join(home, 'anaconda3', 'Scripts', 'conda.exe'),
      join(home, 'micromamba', 'micromamba.exe'),
      join(localAppData, 'miniconda3', 'Scripts', 'conda.exe'),
      join(localAppData, 'anaconda3', 'Scripts', 'conda.exe'),
    )
  } else {
    candidates.push(
      join(home, 'miniconda3', 'bin', 'conda'),
      join(home, 'miniconda3', 'condabin', 'conda'),
      join(home, 'anaconda3', 'bin', 'conda'),
      join(home, 'anaconda3', 'condabin', 'conda'),
      join(home, 'opt', 'miniconda3', 'bin', 'conda'),
      join(home, 'opt', 'miniconda3', 'condabin', 'conda'),
      join(home, 'opt', 'anaconda3', 'bin', 'conda'),
      join(home, 'opt', 'anaconda3', 'condabin', 'conda'),
      join(home, 'micromamba', 'bin', 'micromamba'),
      '/opt/miniconda3/bin/conda',
      '/opt/miniconda3/condabin/conda',
      '/opt/anaconda3/bin/conda',
      '/opt/anaconda3/condabin/conda',
      '/usr/local/miniconda3/bin/conda',
      '/usr/local/anaconda3/bin/conda',
      '/usr/local/Caskroom/miniconda/base/bin/conda', // macOS Homebrew Cask
      '/usr/local/Caskroom/miniconda/base/condabin/conda',
    )
  }

  // Also try deriving from CONDA_PREFIX
  if (process.env.CONDA_PREFIX) {
    const prefix = process.env.CONDA_PREFIX
    candidates.push(
      join(prefix, 'bin', 'conda'),
      join(prefix, 'condabin', 'conda'),
    )
    // If current env is not base, parent dir might contain the installation
    const parent = dirname(prefix)
    if (basename(prefix) !== 'base') {
      candidates.push(
        join(parent, 'bin', 'conda'),
        join(parent, 'condabin', 'conda'),
      )
    }
  }

  return candidates
}

function findCondaInKnownPaths(): string | null {
  for (const p of buildCommonCondaPaths()) {
    if (existsSync(p)) return p
  }
  return null
}

export function getCondaPath(): string | null {
  // 1. Try PATH directly
  try {
    const result = execSync('which conda || command -v conda', {
      encoding: 'utf-8',
      timeout: 3000,
      env: process.env as { [key: string]: string },
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    }).trim().split('\n')[0].trim()
    if (result && existsSync(result)) return result
  } catch {}

  // 2. Check env vars
  if (process.env.CONDA_EXE && existsSync(process.env.CONDA_EXE)) {
    return process.env.CONDA_EXE
  }
  if (process.env._CONDA_EXE && existsSync(process.env._CONDA_EXE)) {
    return process.env._CONDA_EXE
  }

  // 3. Search known install paths
  return findCondaInKnownPaths()
}

export function isCondaInstalled(): boolean {
  const path = getCondaPath()
  if (path) {
    try {
      execSync(`"${path}" --version`, { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' })
      return true
    } catch {}
  }
  return false
}

export function listCondaEnvs(): Array<{ name: string; path: string }> {
  const conda = getCondaPath()
  if (!conda) return []
  try {
    const output = execSync(`"${conda}" env list --json`, { encoding: 'utf-8', timeout: 10000, env: process.env, stdio: 'pipe' })
    const data = JSON.parse(output)
    return data.envs.map((path: string) => ({
      name: path === data.root_prefix ? 'base' : basename(path),
      path,
    }))
  } catch { return [] }
}

// ── User env detection ──

export type PythonEnvType = 'system' | 'uv-agent' | 'user-venv' | 'conda'

export interface PythonEnvInfo {
  type: PythonEnvType
  pythonPath: string | null
  venvPath?: string
  condaEnvName?: string
}

export interface PythonEnvOption {
  id: string
  label: string
  type: PythonEnvType
  pythonPath: string | null
  venvPath?: string
  condaEnvName?: string
}

function getVenvPythonPath(venvPath: string): string | null {
  const python = join(venvPath, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(python) ? python : null
}

function getVenvName(venvPath: string): string {
  const name = basename(venvPath)
  if (name === '.note_agent') return 'Note Agent'
  return name
}

function findVenvsInDir(dir: string, maxDepth = 2): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  const venvNames = ['.venv', 'venv', 'env', '.env', 'virtualenv']

  function scan(currentDir: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (venvNames.includes(entry.name)) {
          const venvPath = join(currentDir, entry.name)
          if (getVenvPythonPath(venvPath)) {
            results.push(venvPath)
          }
        } else if (depth < maxDepth) {
          scan(join(currentDir, entry.name), depth + 1)
        }
      }
    } catch {}
  }

  scan(dir, 0)
  return results
}

/**
 * Detect the "default" workspace Python env (legacy, used by terminal/lsp fallback).
 * Prefers agent venv, then conda, then null.
 */
export function detectWorkspacePythonEnv(workspacePath: string): PythonEnvInfo | null {
  // 1. Check agent venv
  const agentPython = getAgentPythonPath(workspacePath)
  if (agentPython) {
    return { type: 'uv-agent', pythonPath: agentPython, venvPath: getAgentVenvPath(workspacePath) }
  }

  // 2. Check conda
  if (isCondaInstalled()) {
    const envName = `note-agent-${basename(workspacePath)}`
    const envs = listCondaEnvs()
    const existing = envs.find(e => e.name === envName)
    if (existing) {
      const pythonPath = join(existing.path, process.platform === 'win32' ? 'python.exe' : 'bin/python')
      if (existsSync(pythonPath)) {
        return { type: 'conda', pythonPath, condaEnvName: envName }
      }
    }
  }

  return null
}

export function getSystemPythonPath(): string | null {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where python', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' }).trim()
      return result.split('\n')[0].trim() || null
    }
    const result = execSync('which python3', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' }).trim()
    return result || null
  } catch {
    try {
      if (process.platform === 'win32') {
        const result = execSync('where python', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' }).trim()
        return result.split('\n')[0].trim() || null
      }
      const result = execSync('which python', { encoding: 'utf-8', timeout: 3000, env: process.env, stdio: 'pipe' }).trim()
      return result || null
    } catch {}
  }
  return null
}

/**
 * Scan all available Python environments for a workspace.
 * Returns options for the status bar selector.
 */
export function getAvailablePythonEnvs(workspacePath: string): PythonEnvOption[] {
  const options: PythonEnvOption[] = []

  // 1. System Python
  const sysPython = getSystemPythonPath()
  if (sysPython) {
    options.push({
      id: 'system',
      label: '系统 Python',
      type: 'system',
      pythonPath: sysPython,
    })
  }

  // 2. Agent venv (.note_agent/venv)
  const agentVenvPath = getAgentVenvPath(workspacePath)
  const agentPython = getVenvPythonPath(agentVenvPath)
  if (agentPython) {
    options.push({
      id: 'agent-venv',
      label: 'Note Agent venv',
      type: 'uv-agent',
      pythonPath: agentPython,
      venvPath: agentVenvPath,
    })
  }

  // 3. User venvs in workspace (scan .venv, venv, env)
  const userVenvs = findVenvsInDir(workspacePath, 2)
  for (const venvPath of userVenvs) {
    // Skip agent venv (already listed)
    if (venvPath === agentVenvPath) continue
    const python = getVenvPythonPath(venvPath)
    if (!python) continue
    const relPath = venvPath.replace(workspacePath + (process.platform === 'win32' ? '\\' : '/'), '')
    options.push({
      id: `user-venv:${venvPath}`,
      label: `venv: ${relPath}`,
      type: 'user-venv',
      pythonPath: python,
      venvPath,
    })
  }

  // 4. Conda envs
  if (isCondaInstalled()) {
    const envs = listCondaEnvs()
    for (const env of envs) {
      const python = join(env.path, process.platform === 'win32' ? 'python.exe' : 'bin/python')
      if (!existsSync(python)) continue
      options.push({
        id: `conda:${env.name}`,
        label: `conda: ${env.name}`,
        type: 'conda',
        pythonPath: python,
        condaEnvName: env.name,
      })
    }
  }

  return options
}

/**
 * Get the user-selected Python env for a workspace (from settings).
 * Falls back to first available env.
 */
export function getSelectedPythonEnv(
  workspacePath: string,
  savedId: string | null,
): PythonEnvOption | null {
  const envs = getAvailablePythonEnvs(workspacePath)
  if (envs.length === 0) return null
  if (savedId) {
    const match = envs.find(e => e.id === savedId)
    if (match) return match
  }
  return envs[0]
}

// ── pyright config generation ──

export function writePyrightConfig(workspacePath: string, pythonPath?: string | null): void {
  const configPath = join(workspacePath, 'pyrightconfig.json')

  // If a specific pythonPath is given, try to derive venv from it
  let venvPath: string | undefined
  let venvName: string | undefined

  if (pythonPath) {
    // pythonPath is like .../venv/bin/python or .../venv/Scripts/python.exe
    const dir = dirname(pythonPath)
    const parentDir = dirname(dir)
    const grandparentDir = dirname(parentDir)
    // Check if parentDir contains a bin/Scripts directory
    if (basename(dir) === 'bin' || basename(dir) === 'Scripts') {
      venvPath = parentDir.replace(/\\/g, '/')
      venvName = basename(parentDir)
    }
  }

  // Fallback to agent venv
  if (!venvPath) {
    const agentVenv = getAgentVenvPath(workspacePath)
    if (existsSync(agentVenv)) {
      venvPath = agentVenv.replace(/\\/g, '/')
      venvName = 'venv'
    }
  }

  const config: any = {
    pythonVersion: '3.11',
    extraPaths: ['./src'],
    strict: ['*'],
  }

  if (venvPath && venvName) {
    config.venvPath = dirname(venvPath)
    config.venv = venvName
  }

  if (pythonPath) {
    config.pythonPath = pythonPath.replace(/\\/g, '/')
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}
