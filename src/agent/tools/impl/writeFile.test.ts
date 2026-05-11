/**
 * WriteFileTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { WriteFileTool } from './writeFile'
import type { ToolContext } from '../Tool'
import { fileStateCache } from '../../file-cache/FileStateCache'

const TEST_DIR = join(process.cwd(), 'test-writefile')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'execute' }

describe('WriteFileTool', () => {
  beforeEach(() => {
    fileStateCache.clear()
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    fileStateCache.clear()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should create a new file', async () => {
    const result = await WriteFileTool.call({ path: 'new.txt', content: 'hello' }, ctx)
    expect(result.error).toBeUndefined()
    const content = readFileSync(join(TEST_DIR, 'new.txt'), 'utf-8')
    expect(content).toBe('hello')
  })

  it('should overwrite existing file', async () => {
    await WriteFileTool.call({ path: 'exist.txt', content: 'first' }, ctx)
    await WriteFileTool.call({ path: 'exist.txt', content: 'second' }, ctx)
    const content = readFileSync(join(TEST_DIR, 'exist.txt'), 'utf-8')
    expect(content).toBe('second')
  })

  it('should create parent directories', async () => {
    const result = await WriteFileTool.call({ path: 'a/b/c/deep.txt', content: 'deep' }, ctx)
    expect(result.error).toBeUndefined()
    expect(existsSync(join(TEST_DIR, 'a', 'b', 'c', 'deep.txt'))).toBe(true)
  })

  it('should require path and content', () => {
    expect(() => WriteFileTool.validateInput({ path: 'ok', content: 'ok' })).not.toThrow()
    expect(() => WriteFileTool.validateInput({ path: 'ok' })).toThrow()
    expect(() => WriteFileTool.validateInput({ content: 'ok' })).toThrow()
  })

  it('should be destructive', () => {
    expect(WriteFileTool.isDestructive()).toBe(true)
    expect(WriteFileTool.isReadOnly()).toBe(false)
  })
})
