/**
 * Python / uv Virtual Environment Management
 *
 * - Detects or auto-downloads `uv` (Rust-based Python package manager)
 * - Creates per-workspace virtual environments under .note_agent/venv
 * - Routes `python` / `python3` commands to the workspace venv
 */
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import https from 'https'
import { createWriteStream } from 'fs'

const UV_VERSION = '0.6.25'
const UV_DIR = join(homedir(), '.note_agent', 'uv')

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
  // Check if uv is in PATH or in our managed directory
  try {
    execSync('uv --version', { encoding: 'utf-8', timeout: 3000, env: process.env })
    return true
  } catch {}
  return existsSync(getUvPath())
}

export async function ensureUvInstalled(): Promise<string | null> {
  try {
    execSync('uv --version', { encoding: 'utf-8', timeout: 3000, env: process.env })
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

export function getWorkspaceVenvPath(workspacePath: string): string {
  return join(workspacePath, '.note_agent', 'venv')
}

export function getWorkspacePythonPath(workspacePath: string): string | null {
  const venv = getWorkspaceVenvPath(workspacePath)
  const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(python) ? python : null
}

export async function ensureWorkspaceVenv(workspacePath: string): Promise<string | null> {
  const existing = getWorkspacePythonPath(workspacePath)
  if (existing) return existing

  const uv = await ensureUvInstalled()
  if (!uv) return null

  const venvPath = getWorkspaceVenvPath(workspacePath)
  mkdirSync(venvPath, { recursive: true })

  try {
    execSync(`"${uv}" venv "${venvPath}"`, { encoding: 'utf-8', timeout: 60000, env: process.env })
  } catch {
    return null
  }

  return getWorkspacePythonPath(workspacePath)
}

/**
 * Rewrite a command to use the workspace venv python if available.
 */
export function rewritePythonCommand(command: string, workspacePath: string): string {
  const python = getWorkspacePythonPath(workspacePath)
  if (!python) return command
  // Replace leading python/python3 with the venv path
  return command.replace(/^python3?\b/, `"${python}"`)
}
