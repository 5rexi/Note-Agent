import { ipcMain } from 'electron'
import { execSync, spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import { app } from 'electron'
import https from 'https'
import { taskManager } from '../agent'
import { sendToRenderer } from './file-notify'

const TECTONIC_VERSION = '0.16.9'
const TECTONIC_BASE_URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}`

function getBundledDir(): string {
  return join(app.getPath('userData'), 'tectonic')
}

function getBundledTectonicPath(): string | null {
  const dir = getBundledDir()
  const ext = process.platform === 'win32' ? '.exe' : ''

  // Direct path
  const direct = join(dir, `tectonic${ext}`)
  if (existsSync(direct)) return direct

  // Search in subdirectories (tar may extract to a nested folder like tectonic-0.16.9-.../tectonic)
  try {
    const { readdirSync, statSync } = require('fs')
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry)
      if (statSync(entryPath).isDirectory()) {
        const nested = join(entryPath, `tectonic${ext}`)
        if (existsSync(nested)) return nested
      }
    }
  } catch {}

  return null
}

function getTectonicDownloadUrl(): { url: string; archiveName: string } | null {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux' && arch === 'x64') {
    // Use musl (statically linked) build to avoid GLIBC version issues
    const name = `tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`
    return { url: `${TECTONIC_BASE_URL}/${name}`, archiveName: name }
  }
  if (platform === 'darwin' && arch === 'x64') {
    const name = `tectonic-${TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`
    return { url: `${TECTONIC_BASE_URL}/${name}`, archiveName: name }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    const name = `tectonic-${TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`
    return { url: `${TECTONIC_BASE_URL}/${name}`, archiveName: name }
  }
  if (platform === 'win32' && arch === 'x64') {
    const name = `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`
    return { url: `${TECTONIC_BASE_URL}/${name}`, archiveName: name }
  }
  return null
}

async function downloadTectonic(taskId: string): Promise<void> {
  const info = getTectonicDownloadUrl()
  if (!info) {
    throw new Error(`不支持的平台: ${process.platform} ${process.arch}`)
  }

  const dir = getBundledDir()
  mkdirSync(dir, { recursive: true })
  const archivePath = join(dir, info.archiveName)

  // Download with progress
  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(archivePath)
    https.get(info.url, { headers: { 'User-Agent': 'note-agent' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        const location = res.headers.location
        if (!location) {
          reject(new Error('Redirect without location'))
          return
        }
        https.get(location, { headers: { 'User-Agent': 'note-agent' } }, (res2) => {
          handleDownloadResponse(res2, file, taskId, archivePath, resolve, reject)
        }).on('error', reject)
        return
      }
      handleDownloadResponse(res, file, taskId, archivePath, resolve, reject)
    }).on('error', reject)
  })

  // Extract
  taskManager.appendOutput(taskId, '正在解压...')
  await extractArchive(archivePath, dir)

  // Cleanup archive
  try {
    const { unlinkSync } = require('fs')
    unlinkSync(archivePath)
  } catch {}

  // Verify binary exists
  const binaryPath = getBundledTectonicPath()
  if (!binaryPath) {
    throw new Error('解压后未找到 tectonic 可执行文件')
  }

  // Make executable (not needed on Windows)
  if (process.platform !== 'win32') {
    try {
      execSync(`chmod +x "${binaryPath}"`)
    } catch {}
  }

  taskManager.appendOutput(taskId, `tectonic 已安装: ${binaryPath}`)
}

function handleDownloadResponse(
  res: any,
  file: any,
  taskId: string,
  archivePath: string,
  resolve: () => void,
  reject: (err: Error) => void
) {
  const total = parseInt(res.headers['content-length'] || '0', 10)
  let downloaded = 0
  let lastPercent = -1

  res.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    if (total > 0) {
      const percent = Math.floor((downloaded / total) * 100)
      if (percent !== lastPercent) {
        lastPercent = percent
        taskManager.updateProgress(taskId, percent)
        sendToRenderer('task:progress', taskId, percent)
      }
    }
  })

  res.pipe(file)
  file.on('finish', () => {
    file.close()
    resolve()
  })
  file.on('error', (err: Error) => {
    try {
      const { unlinkSync } = require('fs')
      unlinkSync(archivePath)
    } catch {}
    reject(err)
  })
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    // Use pure-JS adm-zip for cross-platform .zip extraction
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(archivePath)
        zip.extractAllTo(destDir, true)
        resolve()
      } catch (err: any) {
        reject(new Error(`解压失败: ${err.message}`))
      }
    })
  }
  // For .tar.gz, use tar command (available on Windows 10+, macOS, Linux)
  return new Promise((resolve, reject) => {
    const args = ['-xzf', archivePath, '-C', destDir]
    const proc = spawn('tar', args, { stdio: 'pipe' })
    let stderr = ''
    proc.stderr?.on('data', (data) => { stderr += data })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`解压失败 (exit ${code}): ${stderr}`))
      }
    })
    proc.on('error', (err) => {
      reject(new Error(`解压命令执行失败: ${err.message}`))
    })
  })
}

// ── PATH 检测 ──
export async function detectLatexCompilers(): Promise<Array<{ name: string; path: string }>> {
  const candidates = ['tectonic', 'xelatex', 'lualatex', 'pdflatex']
  const found: Array<{ name: string; path: string }> = []
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'

  for (const name of candidates) {
    try {
      const result = execSync(`${cmd} ${name}`, { encoding: 'utf-8', timeout: 5000, env: process.env })
      const paths = result.trim().split('\n').map((p) => p.trim()).filter(Boolean)
      if (paths.length > 0) {
        found.push({ name, path: paths[0] })
      }
    } catch {
      // not found
    }
  }
  return found
}

// ── 验证编译器可用性 ──
export async function verifyCompiler(path: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const result = execSync(`"${path}" --version`, { encoding: 'utf-8', timeout: 10000, env: process.env })
    const firstLine = result.trim().split('\n')[0]
    return { ok: true, version: firstLine }
  } catch (err: any) {
    // Some compilers may not support --version, try --help as fallback
    try {
      execSync(`"${path}" --help`, { encoding: 'utf-8', timeout: 10000, env: process.env })
      return { ok: true, version: '未知版本' }
    } catch {
      return { ok: false, error: err.message || '无法执行编译器' }
    }
  }
}

// ── IPC Handlers ──
export function registerLatexSetupHandlers() {
  // Check environment for LaTeX compilers
  ipcMain.handle('latex:checkEnv', async () => {
    try {
      const found = await detectLatexCompilers()
      const bundled = getBundledTectonicPath()
      return { found, bundled }
    } catch (err: any) {
      return { found: [], bundled: null, error: err.message }
    }
  })

  // Verify a compiler can actually run
  ipcMain.handle('latex:verifyCompiler', async (_event, path: string) => {
    return verifyCompiler(path)
  })

  // Get bundled tectonic path
  ipcMain.handle('latex:getBundledPath', async () => {
    return { path: getBundledTectonicPath() }
  })

  // Remove bundled tectonic
  ipcMain.handle('latex:removeBundled', async () => {
    try {
      const { rmSync } = require('fs')
      const dir = getBundledDir()
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Start downloading tectonic as a background task
  ipcMain.handle('latex:downloadTectonic', async () => {
    const urlInfo = getTectonicDownloadUrl()
    if (!urlInfo) {
      return { taskId: null, error: `不支持的平台: ${process.platform} ${process.arch}` }
    }

    const task = taskManager.create('下载 Tectonic', `下载 tectonic ${TECTONIC_VERSION}`, 'latex-download')

    // Start in background (don't await)
    taskManager.start(task.id)
    downloadTectonic(task.id)
      .then(() => {
        taskManager.complete(task.id, `tectonic ${TECTONIC_VERSION} 安装完成`)
        sendToRenderer('task:completed', task.id)
      })
      .catch((err) => {
        taskManager.fail(task.id, err.message)
        sendToRenderer('task:failed', task.id, err.message)
      })

    return { taskId: task.id }
  })

  // Get task progress
  ipcMain.handle('task:get', async (_e, taskId: string) => {
    const task = taskManager.get(taskId)
    return task ?? null
  })
}
