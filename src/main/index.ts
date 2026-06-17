import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, webContents, Menu, globalShortcut } from 'electron'
import { join, isAbsolute, dirname, basename, sep, normalize } from 'path'
import { pathToFileURL } from 'url'
import { writeFileSync, existsSync, mkdirSync, watch, appendFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { Database } from './db'
import { registerFsHandlers } from './fs-utils'
import { registerAgentBridge } from './agent-bridge'
import { registerReportHandlers } from './report'
import { registerLatexHandlers } from './latex-office'
import { registerSyncTexHandlers } from './synctex'
import { registerLatexSetupHandlers } from './latex-setup'
import { registerWordHandlers } from './word-office'
import { registerPandocSetupHandlers } from './pandoc-setup'
// word-setup.ts removed — LibreOffice no longer required
import { registerPdfCacheHandlers } from './pdf-cache'
import { setMainWindow } from './file-notify'
import { taskManager } from '../agent'
import { registerBrowserHost, browserHost, syncBrowserHostFromSettings } from './browser-host'
import { indexKnowledgeFolder, searchKnowledgeBase } from './knowledge-base'

// ── Crash logging ──
const CRASH_LOG_DIR = join(homedir(), '.note_agent', 'logs')
function ensureCrashLogDir(): void {
  if (!existsSync(CRASH_LOG_DIR)) mkdirSync(CRASH_LOG_DIR, { recursive: true })
}
function writeCrashLog(level: string, message: string): void {
  ensureCrashLogDir()
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try { appendFileSync(join(CRASH_LOG_DIR, 'crashes.log'), line, 'utf-8') } catch {}
}

process.on('uncaughtException', (err) => {
  const msg = `[MainProcess uncaughtException] ${err?.message || 'Unknown'}\n${err?.stack || ''}`
  console.error(msg)
  writeCrashLog('FATAL', msg)
})

process.on('unhandledRejection', (reason: any) => {
  const msg = `[MainProcess unhandledRejection] ${reason?.message || String(reason)}\n${reason?.stack || ''}`
  console.error(msg)
  writeCrashLog('ERROR', msg)
})

// Keep a global reference to prevent GC
let mainWindow: BrowserWindow | null = null
let db: Database

const PRELOAD_PATH = join(__dirname, 'preload.cjs')
const RENDERER_PATH = join(__dirname, 'renderer', 'index.html')
const isDev = !app.isPackaged && !existsSync(RENDERER_PATH)

async function createWindow() {
  // Prevent multiple windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    center: true,
    show: false, // Don't show until ready to prevent visual glitches
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // webSecurity disabled via removed CSP meta tag in index.html
    },
  })

  mainWindow.setMenu(null)
  Menu.setApplicationMenu(null)

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    mainWindow!.focus()
    closeSplash()
  })
  setMainWindow(mainWindow)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      console.error('Failed to load dev server:', err)
    })
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL(pathToFileURL(RENDERER_PATH).toString())
  }

  // Log renderer console messages and errors to both stdout and crash log file
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = ['debug', 'info', 'warn', 'error'][level] || 'log'
    const full = `[renderer:${prefix}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`
    console.log(full)
    if (level >= 3) writeCrashLog('RENDERER-ERROR', full)
  })

  // Catch renderer JS errors (including unhandled exceptions)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const msg = `[Renderer crashed] reason=${details.reason}, exitCode=${details.exitCode}`
    console.error(msg)
    writeCrashLog('FATAL', msg)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    const msg = `Renderer failed to load: ${errorCode} ${errorDescription}`
    console.error(msg)
    writeCrashLog('ERROR', msg)
  })

  // Capture DevTools shortcut via webContents (more reliable than globalShortcut in packaged builds)
  // Accept: plain F12, Ctrl+Shift+F12, Alt+F12, etc.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key.toLowerCase() === 'f12') {
      _event.preventDefault()
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Show the window once the renderer paints. Fallback: if first paint never
  // fires (a stuck renderer), show it anyway after a timeout so the app is never
  // permanently invisible — and devtools stays reachable to diagnose.
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      writeCrashLog('WARN', 'ready-to-show did not fire within 15s; showing window anyway')
      mainWindow.show(); mainWindow.focus(); closeSplash()
    }
  }, 15000)

  mainWindow.on('closed', () => {
    clearTimeout(showFallback)
    mainWindow = null
  })
}

// ── Startup splash (shown immediately while the main window loads) ──

const ICON_PATH = join(__dirname, '..', 'assets', 'icon.png')
let splashWindow: BrowserWindow | null = null

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 380, height: 230,
    frame: false, resizable: false, movable: false, center: true,
    show: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#141414',
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splashWindow.setMenu(null)

  let iconB64 = ''
  try { iconB64 = readFileSync(ICON_PATH).toString('base64') } catch { /* no icon */ }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
      background:#141414;color:#fafafa;user-select:none;-webkit-user-select:none}
    img{width:64px;height:64px;border-radius:14px;margin-bottom:14px}
    .name{font-size:18px;font-weight:600;letter-spacing:.3px}
    .status{margin-top:8px;font-size:12px;color:#9a9a9a;min-height:16px;padding:0 24px;text-align:center}
    .bar{margin-top:18px;width:200px;height:3px;border-radius:3px;background:#2a2a2a;overflow:hidden}
    .bar>i{display:block;height:100%;width:40%;border-radius:3px;background:#818CF8;animation:slide 1.1s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
  </style></head><body>
    ${iconB64 ? `<img src="data:image/png;base64,${iconB64}"/>` : ''}
    <div class="name">Note Agent</div>
    <div class="status" id="s">正在启动…</div>
    <div class="bar"><i></i></div>
    <script>window.__status=function(t){var e=document.getElementById('s');if(e)e.textContent=t}</script>
  </body></html>`
  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  splashWindow.once('ready-to-show', () => splashWindow?.show())
  splashWindow.on('closed', () => { splashWindow = null })
}

function setStartupStatus(text: string) {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.__status && window.__status(${JSON.stringify(text)})`)
    .catch(() => {})
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) { try { splashWindow.close() } catch { /* ignore */ } }
  splashWindow = null
}

// Single-instance lock: a second launch focuses the existing window instead of
// spawning a rival process that fights over the same disk/GPU cache dir (the
// "Unable to move the cache: Access Denied" / "Gpu Cache Creation failed"
// errors on Windows come from that contention).
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Silence the (benign) GPU shader disk-cache creation error on locked-down
// Windows installs; shaders just aren't cached to disk.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(async () => {
  createSplashWindow()
  setStartupStatus('正在初始化数据库…')
  db = new Database()
  db.init()
  ;(global as any).__db = db

  // Retention: strip base64 image data from chats older than 30 days. Keeps all
  // conversation TEXT recallable while removing the only payload that grows the DB.
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
    const stripped = db.stripOldImages(cutoff)
    if (stripped > 0) console.log(`[retention] stripped images from ${stripped} old message(s)`)
  } catch (err) {
    console.warn('[retention] stripOldImages failed:', err)
  }

  // Register IPC handlers
  setStartupStatus('正在注册服务…')
  registerDbHandlers()
  registerFsHandlers()
  registerAgentBridge()
  registerDialogHandlers()
  registerReportHandlers(db)
  registerFileWatcher()
  registerLatexHandlers()
  registerSyncTexHandlers()
  registerWordHandlers()
  // registerWordSetupHandlers() removed — LibreOffice no longer required
  registerLatexSetupHandlers()
  registerPdfCacheHandlers()
  registerBrowserHost()
  syncBrowserHostFromSettings((k) => db.getSetting(k))

  // Renderer crash reporter
  ipcMain.on('renderer:crash', (_event, message: string) => {
    console.error(message)
    writeCrashLog('RENDERER-CRASH', message)
  })

  // DevTools opener from renderer
  ipcMain.on('app:openDevTools', (_event) => {
    const sender = webContents.fromId(_event.sender.id)
    if (sender && !sender.isDestroyed()) {
      sender.toggleDevTools()
    }
  })

  // Path utilities for renderer (preload cannot import Node modules in sandbox)
  ipcMain.on('path:join', (event, ...segments: string[]) => { event.returnValue = join(...segments) })
  ipcMain.on('path:dirname', (event, p: string) => { event.returnValue = dirname(p) })
  ipcMain.on('path:basename', (event, p: string, ext?: string) => { event.returnValue = basename(p, ext) })
  ipcMain.on('path:sep', (event) => { event.returnValue = sep })
  ipcMain.on('path:isAbsolute', (event, p: string) => { event.returnValue = isAbsolute(p) })
  ipcMain.on('path:normalize', (event, p: string) => { event.returnValue = normalize(p) })

  taskManager.loadPersisted()

  setStartupStatus('正在准备界面…')

  // Auto-detect / install uv — fire-and-forget so a slow download never blocks
  // (or hangs) app startup. The first Python task waits on it if still running.
  ;(async () => {
    try {
      const { ensureUvInstalled } = await import('./python-env')
      const uvPath = await ensureUvInstalled()
      console.log(uvPath ? `[App] uv ready: ${uvPath}` : '[App] uv not found / could not auto-install')
    } catch (err) {
      console.warn('[App] uv check failed:', err)
    }
  })()

  createWindow()
})

// ── File watcher ──
let currentWatcher: ReturnType<typeof watch> | null = null
let watchedWorkspacePath: string | null = null

function registerFileWatcher() {
  ipcMain.on('fs:watchWorkspace', (_e, workspacePath: string) => {
    if (currentWatcher) {
      currentWatcher.close()
      currentWatcher = null
    }
    watchedWorkspacePath = workspacePath
    if (!workspacePath) return

    try {
      currentWatcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (!filename) return
        const changedPath = isAbsolute(filename) ? filename : join(workspacePath, filename)
        mainWindow.webContents.send('fs:file-changed', { type: eventType, path: changedPath })
      })
    } catch (err) {
      console.warn('[Watcher] Failed to watch workspace:', err)
    }
  })
}



function registerDialogHandlers() {
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择工作区文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) return { path: null, canceled: true }
    return { path: result.filePaths[0], canceled: false }
  })

  ipcMain.handle('dialog:openFile', async (_e, options: { multiple?: boolean; filters?: any[] }) => {
    const result = await dialog.showOpenDialog({
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options.filters,
      title: '选择文件',
    })
    if (result.canceled || result.filePaths.length === 0) return { paths: [], canceled: true }
    return { paths: result.filePaths, canceled: false }
  })
}

ipcMain.handle('app:getPlatform', () => process.platform)

ipcMain.handle('app:getHomeDir', () => app.getPath('home'))

ipcMain.handle('app:setZoomFactor', (_e, factor: number) => {
  const wc = webContents.fromId(_e.sender.id)
  if (wc) wc.setZoomFactor(factor)
})

app.on('before-quit', (e) => {
  e.preventDefault()
  Promise.resolve()
    .then(async () => {
      try {
        const { backgroundTasks } = await import('../agent/tools/impl/background-task-manager')
        backgroundTasks.killAll()
      } catch {}
      try { await browserHost.shutdown() } catch {}
      try { db.close() } catch {}
    })
    .finally(() => {
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    try { db.close() } catch {}
    app.quit()
  }
})

// ── Database IPC handlers ──
function registerDbHandlers() {
  ipcMain.handle('db:workspaces:list', () => db.getWorkspaces())
  ipcMain.handle('db:workspaces:create', (_e, data) => {
    const result = db.createWorkspace(data)
    // Auto-create .note_agent metadata directory
    try {
      const noteAgentDir = join(data.path, '.note_agent')
      if (!existsSync(noteAgentDir)) {
        mkdirSync(noteAgentDir, { recursive: true })
      }
      const scriptsDir = join(noteAgentDir, 'scripts')
      if (!existsSync(scriptsDir)) {
        mkdirSync(scriptsDir, { recursive: true })
      }
      // Auto-create NOTEAGENT.md if not exists
      const noteAgentMd = join(noteAgentDir, 'NOTEAGENT.md')
      if (!existsSync(noteAgentMd)) {
        writeFileSync(noteAgentMd, `# 项目记忆\n\n<!-- 在此记录项目背景、技术栈、约定等信息 -->\n`, 'utf-8')
      }
    } catch {}
    return result
  })
  ipcMain.handle('db:workspaces:update', (_e, id, data) => db.updateWorkspace(id, data))
  ipcMain.handle('db:workspaces:updateModelTier', (_e, id, tier) => db.updateWorkspace(id, { model_tier: tier }))
  ipcMain.handle('db:workspaces:delete', (_e, id) => db.deleteWorkspace(id))

  ipcMain.handle('db:tasks:list', () => db.getTasks())
  ipcMain.handle('db:tasks:listByWorkspace', (_e, workspaceId) => db.getTasksByWorkspace(workspaceId))
  ipcMain.handle('db:tasks:create', (_e, data) => db.createTask(data))
  ipcMain.handle('db:tasks:update', (_e, id, data) => db.updateTask(id, data))
  ipcMain.handle('db:tasks:delete', (_e, id) => db.deleteTask(id))

  ipcMain.handle('db:sessions:getByTask', (_e, taskId) => db.getSessionByTask(taskId))
  ipcMain.handle('db:sessions:create', (_e, data) => db.createSession(data))
  ipcMain.handle('db:sessions:updateMode', (_e, id, mode) => db.updateSessionMode(id, mode))
  ipcMain.handle('db:sessions:updateOverrides', (_e, id, tier, model) => db.updateSessionOverrides(id, tier, model))

  ipcMain.handle('db:messages:list', (_e, sessionId) => db.getMessages(sessionId))
  ipcMain.handle('db:messages:create', (_e, data) => db.createMessage(data))

  ipcMain.handle('db:taskFolders:list', (_e, workspaceId?) => db.getTaskFolders(workspaceId))
  ipcMain.handle('db:taskFolders:create', (_e, data) => db.createTaskFolder(data))
  ipcMain.handle('db:taskFolders:update', (_e, id, data) => db.updateTaskFolder(id, data))
  ipcMain.handle('db:taskFolders:delete', (_e, id) => db.deleteTaskFolder(id))

  ipcMain.handle('db:settings:get', (_e, key) => db.getSetting(key))
  ipcMain.handle('db:settings:set', (_e, key, value) => {
    db.setSetting(key, value)
    if (key === 'browserHostDisabled') {
      syncBrowserHostFromSettings((k) => db.getSetting(k))
    }
  })

  ipcMain.handle('db:messages:listByTasks', (_e, taskIds: string[]) => db.getMessagesByTaskIds(taskIds))
  ipcMain.handle('db:messages:clear', (_e, sessionId: string) => db.clearSessionMessages(sessionId))

  // ── Background Tasks ──
  ipcMain.handle('task:list', () => taskManager.list())
  ipcMain.handle('task:stop', (_e, id: string) => taskManager.stop(id))

  // ── Knowledge Base ──
  ipcMain.handle('kb:folders:add', (_e, path: string, name: string) => db.addKnowledgeFolder(path, name))
  ipcMain.handle('kb:folders:remove', (_e, id: number) => db.removeKnowledgeFolder(id))
  ipcMain.handle('kb:folders:list', () => db.listKnowledgeFolders())
  ipcMain.handle('kb:index', async (_e, folderId: number) => indexKnowledgeFolder(folderId, db))
  ipcMain.handle('kb:search', async (_e, query: string, options?: any) => searchKnowledgeBase(query, db, options))
}
