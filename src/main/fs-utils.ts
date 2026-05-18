import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync, rmdirSync, statSync, existsSync, copyFileSync, realpathSync } from 'fs'
import { join, resolve, relative, sep, basename, normalize } from 'path'
import { homedir } from 'os'

function writeFileFromBase64(filePath: string, base64Data: string): void {
  const buffer = Buffer.from(base64Data, 'base64')
  writeFileSync(filePath, buffer)
}

function readFileAsBase64(filePath: string): string {
  const buffer = readFileSync(filePath)
  return buffer.toString('base64')
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = resolve(targetPath)
  const resolvedRoot = resolve(rootPath)

  // Windows: different drives = definitely outside
  if (process.platform === 'win32') {
    const tDrive = resolvedTarget.match(/^([A-Za-z]:)/)?.[1]
    const rDrive = resolvedRoot.match(/^([A-Za-z]:)/)?.[1]
    if (tDrive && rDrive && tDrive.toLowerCase() !== rDrive.toLowerCase()) {
      return false
    }
  }

  const rel = relative(resolvedRoot, resolvedTarget)
  return !rel.startsWith('..') && !rel.startsWith(sep)
}

function getAllowedRoots(): string[] {
  const db = getDb()
  if (db) {
    try {
      const workspaces = (db as any).listWorkspaces?.() || []
      const paths = workspaces.map((w: any) => w.path).filter(Boolean)
      if (paths.length > 0) return paths
    } catch {}
  }
  return [homedir()]
}

function assertPathAllowed(filePath: string): void {
  const roots = getAllowedRoots()
  const resolved = resolve(filePath)
  // Also resolve symlinks to prevent symlink-based escapes
  let realTarget: string
  try { realTarget = realpathSync(resolved) } catch { realTarget = resolved }

  const allowed = roots.some((root) => isPathInside(realTarget, root) || resolve(realTarget) === resolve(root))
  if (!allowed) {
    throw new Error(`Path not allowed: ${filePath}`)
  }
}

const ILLEGAL_NAME_CHARS = /[<>"|?*\x00-\x1f]/
const SUSPICIOUS_NAME_PATTERNS = [
  /require\s*\(/,
  /import\s+/,
  /const\s+/,
  /let\s+/,
  /var\s+/,
  /function\s+/,
  /=>\s*\{/,
]

function isSuspiciousFileName(name: string): boolean {
  if (SUSPICIOUS_NAME_PATTERNS.some((re) => re.test(name))) return true
  if (name.includes('\n') || name.includes('\r')) return true
  if (name.length > 200) return true
  return false
}

function validateFilePath(filePath: string): string {
  const norm = normalize(filePath)
  // Block path traversal sequences
  if (norm.split(sep).some((part) => part === '..')) {
    throw new Error(`Path traversal not allowed: ${filePath}`)
  }
  const fileName = basename(norm)
  if (ILLEGAL_NAME_CHARS.test(fileName)) {
    throw new Error(`File name contains illegal characters: ${fileName}`)
  }
  if (isSuspiciousFileName(fileName)) {
    throw new Error(`File name looks like a code snippet: ${fileName}`)
  }
  return norm
}

function getDb() {
  return (global as any).__db as import('./db').Database | undefined
}

const BINARY_EXTS = new Set([
  'docx', 'xlsx', 'pptx', 'pdf',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
])

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return BINARY_EXTS.has(ext)
}

export function registerFsHandlers() {
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      const normPath = validateFilePath(filePath)
      const content = readFileSync(normPath, 'utf-8')
      return { content }
    } catch (err: any) {
      return { content: '', error: err.message }
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const normPath = validateFilePath(filePath)
      // Push current content to history before overwriting (multi-step undo)
      if (existsSync(normPath)) {
        const db = getDb()
        if (db) {
          if (isBinaryFile(normPath)) {
            const current = readFileSync(normPath)
            db.pushFileHistory(normPath, current.toString('base64'), true)
          } else {
            const current = readFileSync(normPath, 'utf-8')
            db.pushFileHistory(normPath, current, false)
          }
        }
      }
      writeFileSync(normPath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:listFiles', async (_event, dirPath: string) => {
    try {
      function walk(dir: string, basePath: string): any[] {
        const entries = readdirSync(dir, { withFileTypes: true })
        return entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => {
            const fullPath = join(dir, e.name)
            const relPath = join(basePath, e.name)
            if (e.isDirectory()) {
              return { name: e.name, path: relPath, type: 'directory', children: walk(fullPath, relPath) }
            }
            return { name: e.name, path: relPath, type: 'file' }
          })
      }
      return { entries: walk(dirPath, '') }
    } catch (err: any) {
      return { entries: [], error: err.message }
    }
  })

  ipcMain.handle('fs:readFileBase64', async (_event, filePath: string) => {
    try {
      const normPath = validateFilePath(filePath)
      const data = readFileAsBase64(normPath)
      return { data }
    } catch (err: any) {
      return { data: '', error: err.message }
    }
  })

  ipcMain.handle('fs:searchFiles', async (_event, dirPath: string, query: string) => {
    try {
      const results: { path: string; name: string; matches: number }[] = []
      function searchDir(dir: string, relPrefix: string = '') {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git' && !entry.name.startsWith('.')) {
              searchDir(fullPath, relPath)
            }
          } else if (entry.isFile()) {
            // Match by filename
            if (entry.name.toLowerCase().includes(query.toLowerCase()) || relPath.toLowerCase().includes(query.toLowerCase())) {
              results.push({ path: relPath, name: entry.name, matches: 1 })
            }
          }
        }
      }
      searchDir(dirPath)
      return { results: results.slice(0, 20) }
    } catch (err: any) {
      return { results: [], error: err.message }
    }
  })

  // ── File tree operations ──

  ipcMain.handle('fs:rename', async (_event, dirPath: string, oldName: string, newName: string) => {
    try {
      const oldPath = join(dirPath, oldName)
      const newPath = join(dirPath, newName)
      if (!isPathInside(oldPath, dirPath) || !isPathInside(newPath, dirPath)) {
        return { success: false, error: 'Path escapes workspace' }
      }
      renameSync(oldPath, newPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:delete', async (_event, dirPath: string, name: string) => {
    try {
      const targetPath = join(dirPath, name)
      if (!isPathInside(targetPath, dirPath)) {
        return { success: false, error: 'Path escapes workspace' }
      }
      const s = statSync(targetPath)
      if (s.isDirectory()) {
        rmdirSync(targetPath, { recursive: true })
      } else {
        unlinkSync(targetPath)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:writeFileBase64', async (_event, filePath: string, base64Data: string) => {
    try {
      const normPath = validateFilePath(filePath)
      // Push current content to history before overwriting (multi-step undo)
      if (existsSync(normPath)) {
        const current = readFileSync(normPath)
        const db = getDb()
        if (db) {
          db.pushFileHistory(normPath, current.toString('base64'), true)
        }
      }
      writeFileFromBase64(normPath, base64Data)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:undoWrite', async (_event, filePath: string) => {
    try {
      const db = getDb()
      if (!db) {
        return { success: false, error: '数据库未初始化' }
      }
      const history = db.popFileHistory(filePath)
      if (!history) {
        return { success: false, error: '没有可撤销的历史' }
      }
      // Use the stored isBinary flag if available; fall back to extension check
      if (history.isBinary ?? isBinaryFile(filePath)) {
        const buffer = Buffer.from(history.content, 'base64')
        writeFileSync(filePath, buffer)
      } else {
        writeFileSync(filePath, history.content, 'utf-8')
      }
      return { success: true, version: history.version }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:move', async (_event, dirPath: string, srcRelativePath: string, targetDirRelative: string) => {
    try {
      const srcPath = join(dirPath, srcRelativePath)
      const fileName = basename(srcRelativePath)
      const dstPath = join(dirPath, targetDirRelative, fileName)
      if (!isPathInside(srcPath, dirPath) || !isPathInside(dstPath, dirPath)) {
        return { success: false, error: 'Path escapes workspace' }
      }
      renameSync(srcPath, dstPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Create a snapshot backup of the current file state.
  // Overwrites any existing backup — intended to be called when a file is opened.
  ipcMain.handle('fs:snapshotBackup', async (_event, filePath: string) => {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      const stats = statSync(filePath)
      if (stats.size === 0) {
        return { success: false, error: '文件为空，不创建备份' }
      }
      const db = getDb()
      if (db) {
        // Only push if no history exists yet for this file
        const count = db.getFileHistoryCount(filePath)
        if (count === 0) {
          if (isBinaryFile(filePath)) {
            const content = readFileSync(filePath)
            db.pushFileHistory(filePath, content.toString('base64'))
          } else {
            const content = readFileSync(filePath, 'utf-8')
            db.pushFileHistory(filePath, content)
          }
        }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:getUndoCount', async (_event, filePath: string) => {
    try {
      const db = getDb()
      if (!db) return { count: 0 }
      return { count: db.getFileHistoryCount(filePath) }
    } catch {
      return { count: 0 }
    }
  })
}
