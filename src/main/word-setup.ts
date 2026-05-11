import { ipcMain, shell, app } from 'electron'
import { execSync, spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, rmSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import https from 'https'
import http from 'http'
import { tmpdir } from 'os'
import { taskManager } from '../agent'
import { sendToRenderer } from './file-notify'

const LO_VERSION = '25.8.6'
const LO_BASE_URL = `https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}`

function getBundledDir(): string {
  return join(app.getPath('userData'), 'libreoffice')
}

function getBundledSofficePath(): string | null {
  const dir = getBundledDir()
  const platform = process.platform

  if (platform === 'linux') {
    // Search for soffice under opt/libreoffice*/program/
    const optDir = join(dir, 'opt')
    if (!existsSync(optDir)) return null
    try {
      for (const entry of readdirSync(optDir)) {
        const programDir = join(optDir, entry, 'program')
        const sofficePath = join(programDir, 'soffice')
        if (existsSync(sofficePath)) return sofficePath
      }
    } catch {}
    return null
  }

  if (platform === 'win32') {
    const sofficePath = join(dir, 'program', 'soffice.exe')
    if (existsSync(sofficePath)) return sofficePath
    return null
  }

  if (platform === 'darwin') {
    const appPath = join(dir, 'LibreOffice.app')
    const sofficePath = join(appPath, 'Contents', 'MacOS', 'soffice')
    if (existsSync(sofficePath)) return sofficePath
    // Also check for versioned app name
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.app')) {
          const sofficePath = join(dir, entry, 'Contents', 'MacOS', 'soffice')
          if (existsSync(sofficePath)) return sofficePath
        }
      }
    } catch {}
    return null
  }

  return null
}

function getLibreOfficeDownloadUrl(): { url: string; fileName: string } | null {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux' && arch === 'x64') {
    const name = `LibreOffice_${LO_VERSION}_Linux_x86-64_deb.tar.gz`
    return { url: `${LO_BASE_URL}/deb/x86_64/${name}`, fileName: name }
  }
  if (platform === 'win32' && arch === 'x64') {
    const name = `LibreOffice_${LO_VERSION}_Win_x86-64.msi`
    return { url: `${LO_BASE_URL}/win/x86_64/${name}`, fileName: name }
  }
  if (platform === 'win32' && arch === 'arm64') {
    const name = `LibreOffice_${LO_VERSION}_Win_aarch64.msi`
    return { url: `${LO_BASE_URL}/win/aarch64/${name}`, fileName: name }
  }
  if (platform === 'darwin' && arch === 'x64') {
    const name = `LibreOffice_${LO_VERSION}_MacOS_x86-64.dmg`
    return { url: `${LO_BASE_URL}/mac/x86_64/${name}`, fileName: name }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    const name = `LibreOffice_${LO_VERSION}_MacOS_aarch64.dmg`
    return { url: `${LO_BASE_URL}/mac/aarch64/${name}`, fileName: name }
  }
  return null
}

// ── Download with progress ──

function downloadFile(url: string, destPath: string, taskId: string, redirectCount: number = 0): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects'))
  }
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)
    const doRequest = (requestUrl: string) => {
      const protocol = requestUrl.startsWith('https:') ? https : http
      protocol.get(requestUrl, { headers: { 'User-Agent': 'note-agent' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers.location
          if (!location) {
            file.close()
            reject(new Error('Redirect without location'))
            return
          }
          // Resolve relative URLs and protocol-relative URLs
          const redirectUrl = new URL(location, requestUrl).toString()
          res.destroy()
          doRequest(redirectUrl)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          reject(new Error(`Download failed with status ${res.statusCode}`))
          return
        }
        handleDownloadResponse(res, file, taskId, destPath, resolve, reject)
      }).on('error', (err) => {
        file.close()
        reject(err)
      })
    }
    doRequest(url)
  })
}

function handleDownloadResponse(
  res: any,
  file: any,
  taskId: string,
  destPath: string,
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
    try { rmSync(destPath, { force: true }) } catch {}
    reject(err)
  })
}

// ── Platform-specific installation ──

async function installLibreOfficeLinux(archivePath: string, destDir: string, taskId: string): Promise<void> {
  const tempDir = join(tmpdir(), `lo-extract-${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    // Step 1: Extract tar.gz
    taskManager.appendOutput(taskId, '解压主归档...')
    await extractTarGz(archivePath, tempDir)

    // Step 2: Find DEBS directory
    const debsDir = findDebDirectory(tempDir)
    if (!debsDir) {
      throw new Error('未找到 DEBS 目录')
    }

    // Step 3: Extract each .deb package
    taskManager.appendOutput(taskId, '提取 deb 包...')
    const debFiles = readdirSync(debsDir).filter((f) => f.endsWith('.deb'))
    const total = debFiles.length

    for (let i = 0; i < debFiles.length; i++) {
      const debFile = join(debsDir, debFiles[i])
      await extractDeb(debFile, destDir)
      const progress = Math.floor(((i + 1) / total) * 50) + 30 // 30-80% range
      taskManager.updateProgress(taskId, progress)
      sendToRenderer('task:progress', taskId, progress)
    }

    // Step 4: Verify soffice exists
    const sofficePath = getBundledSofficePath()
    if (!sofficePath) {
      throw new Error('安装后未找到 soffice 可执行文件')
    }

    taskManager.appendOutput(taskId, `LibreOffice 已安装: ${sofficePath}`)
  } finally {
    // Cleanup temp
    try { rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
}

async function installLibreOfficeWindows(msiPath: string, _destDir: string, taskId: string): Promise<void> {
  taskManager.appendOutput(taskId, 'MSI 下载完成，正在打开安装程序...')
  // On Windows, open the MSI and let the user install it manually.
  // After manual installation, soffice will be available via PATH.
  try {
    const result = await shell.openPath(msiPath)
    if (result && result !== '') {
      // openPath returned an error message; try openExternal as fallback
      await shell.openExternal(`file://${msiPath.replace(/\\/g, '/')}`)
    }
  } catch {
    await shell.openExternal(`file://${msiPath.replace(/\\/g, '/')}`)
  }
  taskManager.appendOutput(taskId, '请在弹出的安装向导中完成 LibreOffice 安装。安装完成后重启应用即可自动识别。')
}

async function installLibreOfficeMacOS(dmgPath: string, destDir: string, taskId: string): Promise<void> {
  const mountPoint = join(tmpdir(), `lo-mount-${Date.now()}`)
  mkdirSync(mountPoint, { recursive: true })

  try {
    // Attach DMG
    taskManager.appendOutput(taskId, '挂载 DMG...')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse'], { stdio: 'pipe' })
      let stderr = ''
      proc.stderr?.on('data', (data) => { stderr += data })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`DMG 挂载失败 (exit ${code}): ${stderr}`))
      })
      proc.on('error', (err) => reject(new Error(`hdiutil 启动失败: ${err.message}`)))
    })

    // Find .app
    taskManager.appendOutput(taskId, '复制应用...')
    const entries = readdirSync(mountPoint).filter((e) => e.endsWith('.app'))
    if (entries.length === 0) {
      throw new Error('DMG 中未找到 .app 文件')
    }

    const appName = entries[0]
    const srcApp = join(mountPoint, appName)
    const destApp = join(destDir, appName)

    // Remove existing
    if (existsSync(destApp)) {
      rmSync(destApp, { recursive: true, force: true })
    }

    // Copy
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('cp', ['-R', srcApp, destApp], { stdio: 'pipe' })
      let stderr = ''
      proc.stderr?.on('data', (data) => { stderr += data })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`复制失败 (exit ${code}): ${stderr}`))
      })
      proc.on('error', (err) => reject(new Error(`cp 启动失败: ${err.message}`)))
    })

    // Detach
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('hdiutil', ['detach', mountPoint], { stdio: 'pipe' })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else resolve() // ignore detach errors
      })
      proc.on('error', () => resolve())
    })

    const sofficePath = getBundledSofficePath()
    if (!sofficePath) {
      throw new Error('安装后未找到 soffice')
    }
    taskManager.appendOutput(taskId, `LibreOffice 已安装: ${sofficePath}`)
  } finally {
    try { rmSync(mountPoint, { recursive: true, force: true }) } catch {}
  }
}

// ── Helpers ──

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'pipe' })
    let stderr = ''
    proc.stderr?.on('data', (data) => { stderr += data })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar 解压失败 (exit ${code}): ${stderr}`))
    })
    proc.on('error', (err) => reject(new Error(`tar 启动失败: ${err.message}`)))
  })
}

function findDebDirectory(rootDir: string): string | null {
  function walk(dir: string): string | null {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.toUpperCase() === 'DEBS') return fullPath
        const found = walk(fullPath)
        if (found) return found
      }
    }
    return null
  }
  return walk(rootDir)
}

async function extractDeb(debPath: string, destDir: string): Promise<void> {
  const tempDir = join(tmpdir(), `deb-extract-${Date.now()}-${basename(debPath, '.deb')}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    // Try dpkg-deb first (Debian/Ubuntu)
    try {
      execSync(`dpkg-deb -x "${debPath}" "${destDir}"`, { timeout: 30000, stdio: 'pipe' })
      return
    } catch {
      // fallback to ar + tar
    }

    // ar x debPath → extract data.tar.*
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ar', ['x', debPath], { cwd: tempDir, stdio: 'pipe' })
      let stderr = ''
      proc.stderr?.on('data', (data) => { stderr += data })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ar 提取失败 (exit ${code}): ${stderr}`))
      })
      proc.on('error', (err) => reject(new Error(`ar 启动失败: ${err.message}`)))
    })

    // Find data.tar.*
    const dataTar = readdirSync(tempDir).find((f) => f.startsWith('data.tar'))
    if (!dataTar) {
      throw new Error('deb 包中未找到 data.tar')
    }

    // Extract data.tar.* to destDir
    const isXz = dataTar.endsWith('.xz')
    const tarArgs = isXz ? ['-xf', join(tempDir, dataTar), '-C', destDir] : ['-xf', join(tempDir, dataTar), '-C', destDir]
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', tarArgs, { stdio: 'pipe' })
      let stderr = ''
      proc.stderr?.on('data', (data) => { stderr += data })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar 解压失败 (exit ${code}): ${stderr}`))
      })
      proc.on('error', (err) => reject(new Error(`tar 启动失败: ${err.message}`)))
    })
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
}

// ── Download orchestration ──

async function downloadLibreOffice(taskId: string): Promise<void> {
  const info = getLibreOfficeDownloadUrl()
  if (!info) {
    throw new Error(`不支持的平台: ${process.platform} ${process.arch}`)
  }

  const platform = process.platform
  const dir = getBundledDir()

  // On Windows, download MSI to Downloads folder and let user install manually
  const isWindows = platform === 'win32'
  const downloadDir = isWindows ? app.getPath('downloads') : dir

  // Clean up old installation (Linux/macOS only)
  if (!isWindows && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!isWindows) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = join(downloadDir, info.fileName)

  // Download
  taskManager.appendOutput(taskId, `下载 LibreOffice ${LO_VERSION}...`)
  await downloadFile(info.url, filePath, taskId)

  // Install
  taskManager.appendOutput(taskId, '正在安装...')
  taskManager.updateProgress(taskId, 30)
  sendToRenderer('task:progress', taskId, 30)

  if (platform === 'linux') {
    await installLibreOfficeLinux(filePath, dir, taskId)
    // Cleanup installer
    try { rmSync(filePath, { force: true }) } catch {}
  } else if (platform === 'win32') {
    await installLibreOfficeWindows(filePath, dir, taskId)
    // Don't delete MSI on Windows — user may need to re-run installer
  } else if (platform === 'darwin') {
    await installLibreOfficeMacOS(filePath, dir, taskId)
    // Cleanup installer
    try { rmSync(filePath, { force: true }) } catch {}
  }

  // Make soffice executable on Linux/macOS
  if (platform !== 'win32') {
    const sofficePath = getBundledSofficePath()
    if (sofficePath) {
      try { execSync(`chmod +x "${sofficePath}"`) } catch {}
    }
  }
}

// ── PATH 检测 ──

export async function detectSoffice(): Promise<Array<{ name: string; path: string }>> {
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'
  const names = isWindows
    ? ['soffice.exe', 'soffice', 'libreoffice.exe']
    : ['soffice', 'libreoffice']

  const found: Array<{ name: string; path: string }> = []

  // Windows: also check common installation paths (not in PATH by default)
  if (isWindows) {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const fixedPaths = [
      `${programFiles}\\LibreOffice\\program\\soffice.exe`,
      `${programFilesX86}\\LibreOffice\\program\\soffice.exe`,
    ]
    for (const p of fixedPaths) {
      if (existsSync(p)) {
        found.push({ name: 'soffice.exe', path: p })
      }
    }
  }

  for (const name of names) {
    try {
      const result = execSync(`${cmd} ${name}`, { encoding: 'utf-8', timeout: 5000, env: process.env, windowsHide: true })
      const paths = result.trim().split('\n').map((p) => p.trim()).filter(Boolean)
      if (paths.length > 0) {
        // avoid duplicates
        if (!found.some((f) => f.path === paths[0])) {
          found.push({ name, path: paths[0] })
        }
      }
    } catch {
      // not found
    }
  }
  return found
}

// ── 验证 soffice 可用性 ──

export async function verifySoffice(path: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const result = execSync(`"${path}" --version`, { encoding: 'utf-8', timeout: 10000, env: process.env, windowsHide: true })
    const firstLine = result.trim().split('\n')[0]
    return { ok: true, version: firstLine }
  } catch (err: any) {
    try {
      execSync(`"${path}" --help`, { encoding: 'utf-8', timeout: 10000, env: process.env, windowsHide: true })
      return { ok: true, version: '未知版本' }
    } catch {
      return { ok: false, error: err.message || '无法执行 soffice' }
    }
  }
}

// ── IPC Handlers ──

export function registerWordSetupHandlers() {
  ipcMain.handle('word:checkEnv', async () => {
    try {
      const found = await detectSoffice()
      const bundled = getBundledSofficePath()
      return { found, bundled }
    } catch (err: any) {
      return { found: [], bundled: null, error: err.message }
    }
  })

  ipcMain.handle('word:verifySoffice', async (_event, path: string) => {
    return verifySoffice(path)
  })

  ipcMain.handle('word:getBundledPath', async () => {
    return { path: getBundledSofficePath() }
  })

  ipcMain.handle('word:removeBundled', async () => {
    try {
      const dir = getBundledDir()
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
      // On Windows, also try to clean up the downloaded MSI in downloads
      if (process.platform === 'win32') {
        try {
          const info = getLibreOfficeDownloadUrl()
          if (info) {
            const dlPath = join(app.getPath('downloads'), info.fileName)
            if (existsSync(dlPath)) rmSync(dlPath, { force: true })
          }
        } catch {}
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('word:downloadLibreOffice', async () => {
    const urlInfo = getLibreOfficeDownloadUrl()
    if (!urlInfo) {
      return { taskId: null, error: `不支持的平台: ${process.platform} ${process.arch}` }
    }

    const task = taskManager.create(
      '下载 LibreOffice',
      `下载 LibreOffice ${LO_VERSION} (${urlInfo.fileName})`,
      'libreoffice-download'
    )

    taskManager.start(task.id)
    downloadLibreOffice(task.id)
      .then(() => {
        taskManager.complete(task.id, `LibreOffice ${LO_VERSION} 安装完成`)
        sendToRenderer('task:completed', task.id)
      })
      .catch((err) => {
        taskManager.fail(task.id, err.message)
        sendToRenderer('task:failed', task.id, err.message)
      })

    return { taskId: task.id }
  })
}
