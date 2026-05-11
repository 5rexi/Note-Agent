// Lazy-load electron to support CLI (non-Electron) environments
let BrowserWindow: any = null
let mainWindow: any = null

function getBrowserWindow() {
  if (BrowserWindow) return BrowserWindow
  try {
    const electron = require('electron')
    BrowserWindow = electron.BrowserWindow
    return BrowserWindow
  } catch {
    return null
  }
}

export function setMainWindow(win: any) {
  mainWindow = win
}

export function notifyFileChanged(path: string) {
  if (!mainWindow || mainWindow.isDestroyed?.()) return
  mainWindow.webContents?.send('fs:file-changed', { type: 'change', path })
}

export function sendToRenderer(channel: string, ...args: any[]) {
  if (!mainWindow || mainWindow.isDestroyed?.()) return
  mainWindow.webContents?.send(channel, ...args)
}
