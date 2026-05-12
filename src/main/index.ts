import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, webContents, Menu } from 'electron'
import { join, isAbsolute, dirname, basename, sep, normalize } from 'path'
import { pathToFileURL } from 'url'
import { writeFileSync, existsSync, mkdirSync, watch } from 'fs'
import { Database } from './db'
import { registerFsHandlers } from './fs-utils'
import { registerAgentBridge } from './agent-bridge'
import { registerReportHandlers } from './report'
import { registerLatexHandlers, registerOfficeHandlers } from './latex-office'
import { registerLatexSetupHandlers } from './latex-setup'
import { registerWordHandlers } from './word-office'
import { registerWordSetupHandlers } from './word-setup'
import { registerPdfCacheHandlers } from './pdf-cache'
import { setMainWindow } from './file-notify'
import { taskManager } from '../agent'
import { registerBrowserHost, browserHost, syncBrowserHostFromSettings } from './browser-host'
import { indexKnowledgeFolder, searchKnowledgeBase } from './knowledge-base'

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

  // Log renderer console messages and errors
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = ['debug', 'info', 'warn', 'error'][level] || 'log'
    console.log(`[renderer:${prefix}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription)
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  db = new Database()
  db.init()
  ;(global as any).__db = db

  // Register IPC handlers
  registerDbHandlers()
  registerFsHandlers()
  registerAgentBridge()
  registerDialogHandlers()
  registerReportHandlers(db)
  registerFileWatcher()
  registerLatexHandlers()
  registerOfficeHandlers()
  registerWordHandlers()
  registerWordSetupHandlers()
  registerLatexSetupHandlers()
  registerPdfCacheHandlers()
  registerBrowserHost()
  syncBrowserHostFromSettings((k) => db.getSetting(k))

  // Path utilities for renderer (preload cannot import Node modules in sandbox)
  ipcMain.on('path:join', (event, ...segments: string[]) => { event.returnValue = join(...segments) })
  ipcMain.on('path:dirname', (event, p: string) => { event.returnValue = dirname(p) })
  ipcMain.on('path:basename', (event, p: string, ext?: string) => { event.returnValue = basename(p, ext) })
  ipcMain.on('path:sep', (event) => { event.returnValue = sep })
  ipcMain.on('path:isAbsolute', (event, p: string) => { event.returnValue = isAbsolute(p) })
  ipcMain.on('path:normalize', (event, p: string) => { event.returnValue = normalize(p) })

  taskManager.loadPersisted()

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

app.on('before-quit', async () => {
  try {
    await browserHost.shutdown()
  } catch {
    // ignore
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
