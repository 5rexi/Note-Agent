/**
 * FileStateCache — 防止过时写入 (stale write)
 *
 * 设计文档第04章：每次文件读取时记录哈希/时间戳，
 * 编辑前检查文件是否被外部修改。
 */
import { readFileSync, statSync, existsSync } from 'fs'
import { createHash } from 'crypto'

/**
 * Hash on NORMALIZED (LF) content so a pure line-ending conversion (CRLF↔LF,
 * e.g. the editor re-saving a Windows file) does NOT false-trigger the
 * stale-write guard.
 */
function contentHashOf(path: string): string {
  const content = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export interface FileState {
  path: string
  mtimeMs: number
  size: number
  contentHash: string
}

class FileStateCache {
  private cache = new Map<string, FileState>()

  /**
   * 记录文件当前状态（通常在 readFile 后调用）
   */
  record(path: string): FileState | undefined {
    if (!existsSync(path)) {
      this.cache.delete(path)
      return undefined
    }

    const stat = statSync(path)
    const hash = contentHashOf(path)

    const state: FileState = {
      path,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentHash: hash,
    }

    this.cache.set(path, state)
    return state
  }

  /**
   * 检查文件是否自上次记录后发生变化
   */
  hasChanged(path: string): { changed: boolean; reason?: string } {
    const cached = this.cache.get(path)
    if (!cached) {
      return { changed: false } // No prior record, assume ok
    }

    if (!existsSync(path)) {
      return { changed: true, reason: 'File was deleted' }
    }

    const stat = statSync(path)
    // Always recompute hash for reliability (mtime may not change in rapid writes)
    const hash = contentHashOf(path)
    if (hash !== cached.contentHash) {
      return { changed: true, reason: `File was modified externally (content hash changed)` }
    }
    // Update metadata if changed but content same
    if (stat.mtimeMs !== cached.mtimeMs || stat.size !== cached.size) {
      cached.mtimeMs = stat.mtimeMs
      cached.size = stat.size
    }

    return { changed: false }
  }

  /**
   * 强制检查：如果文件变化则抛出错误
   */
  assertUnchanged(path: string): void {
    const result = this.hasChanged(path)
    if (result.changed) {
      throw new Error(`Stale write detected: ${path}. ${result.reason}. Please re-read the file before editing.`)
    }
  }

  get(path: string): FileState | undefined {
    return this.cache.get(path)
  }

  clear(): void {
    this.cache.clear()
  }

  remove(path: string): void {
    this.cache.delete(path)
  }
}

export const fileStateCache = new FileStateCache()
