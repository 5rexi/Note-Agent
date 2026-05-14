import { ipcMain, app } from 'electron'
import { execSync, spawn } from 'child_process'
import {
  existsSync, mkdirSync, createWriteStream, unlinkSync,
  readdirSync, statSync, rmSync,
} from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import https from 'https'
import { taskManager } from '../agent'
import { sendToRenderer } from './file-notify'

const PANDOC_VERSION = '3.1.11'
const PANDOC_BASE_URL = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}`

function getBundledDir(): string {
  return join(app.getPath('userData'), 'pandoc')
}

export function getBundledPandocPath(): string | null {
  const dir = getBundledDir()
  const ext = process.platform === 'win32' ? '.exe' : ''

  // Direct path
  const direct = join(dir, `pandoc${ext}`)
  if (existsSync(direct)) return direct

  // Windows zip structure: pandoc-3.1.11/pandoc.exe
  const versionDir = join(dir, `pandoc-${PANDOC_VERSION}`)
  const inVersionDir = join(versionDir, `pandoc${ext}`)
  if (existsSync(inVersionDir)) return inVersionDir

  // macOS/Linux tar.gz structure: pandoc-3.1.11/bin/pandoc
  const inBin = join(versionDir, 'bin', `pandoc${ext}`)
  if (existsSync(inBin)) return inBin

  // Search any subdirectory
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry)
      if (statSync(entryPath).isDirectory()) {
        const nested = join(entryPath, `pandoc${ext}`)
        if (existsSync(nested)) return nested
        const nestedBin = join(entryPath, 'bin', `pandoc${ext}`)
        if (existsSync(nestedBin)) return nestedBin
      }
    }
  } catch {}

  return null
}

function getPandocDownloadUrl(): { url: string; archiveName: string } | null {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux' && arch === 'x64') {
    const name = `pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz`
    return { url: `${PANDOC_BASE_URL}/${name}`, archiveName: name }
  }
  if (platform === 'darwin') {
    // macOS releases are universal or arch-specific depending on version
    if (arch === 'arm64') {
      const name = `pandoc-${PANDOC_VERSION}-arm64-macOS.zip`
      return { url: `${PANDOC_BASE_URL}/${name}`, archiveName: name }
    }
    const name = `pandoc-${PANDOC_VERSION}-x86_64-macOS.zip`
    return { url: `${PANDOC_BASE_URL}/${name}`, archiveName: name }
  }
  if (platform === 'win32' && arch === 'x64') {
    const name = `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`
    return { url: `${PANDOC_BASE_URL}/${name}`, archiveName: name }
  }
  return null
}

async function downloadPandoc(taskId: string): Promise<void> {
  const info = getPandocDownloadUrl()
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
  try { unlinkSync(archivePath) } catch {}

  // Verify binary exists
  const binaryPath = getBundledPandocPath()
  if (!binaryPath) {
    throw new Error('解压后未找到 pandoc 可执行文件')
  }

  // Make executable (not needed on Windows)
  if (process.platform !== 'win32') {
    try { execSync(`chmod +x "${binaryPath}"`) } catch {}
  }

  taskManager.appendOutput(taskId, `pandoc 已安装: ${binaryPath}`)
}

function handleDownloadResponse(
  res: any,
  file: any,
  taskId: string,
  archivePath: string,
  resolve: () => void,
  reject: (err: Error) => void,
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
    try { unlinkSync(archivePath) } catch {}
    reject(err)
  })
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
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
  // For .tar.gz
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

export function registerPandocSetupHandlers() {
  ipcMain.handle('pandoc:getBundledPath', async () => {
    return { path: getBundledPandocPath() }
  })

  ipcMain.handle('pandoc:removeBundled', async () => {
    try {
      const dir = getBundledDir()
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pandoc:download', async () => {
    const urlInfo = getPandocDownloadUrl()
    if (!urlInfo) {
      return { taskId: null, error: `不支持的平台: ${process.platform} ${process.arch}` }
    }

    const task = taskManager.create('下载 Pandoc', `下载 pandoc ${PANDOC_VERSION}`, 'pandoc-download')

    taskManager.start(task.id)
    downloadPandoc(task.id)
      .then(() => {
        taskManager.complete(task.id, `pandoc ${PANDOC_VERSION} 安装完成`)
        sendToRenderer('task:completed', task.id)
      })
      .catch((err) => {
        taskManager.fail(task.id, err.message)
        sendToRenderer('task:failed', task.id, err.message)
      })

    return { taskId: task.id }
  })
}
