/**
 * EditFileTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { EditFileTool } from './editFile'
import type { ToolContext } from '../Tool'
import { fileStateCache } from '../../file-cache/FileStateCache'

const TEST_DIR = join(process.cwd(), 'test-editfile')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'execute' }

describe('EditFileTool', () => {
  beforeEach(() => {
    fileStateCache.clear()
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    fileStateCache.clear()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should replace exact text', async () => {
    writeFileSync(join(TEST_DIR, 'file.txt'), 'hello world foo bar', 'utf-8')
    const result = await EditFileTool.call({ path: 'file.txt', search: 'world', replace: 'universe' }, ctx)
    expect(result.error).toBeUndefined()
    const content = readFileSync(join(TEST_DIR, 'file.txt'), 'utf-8')
    expect(content).toBe('hello universe foo bar')
  })

  it('should replace multiline text', async () => {
    writeFileSync(join(TEST_DIR, 'file.txt'), 'line1\nline2\nline3', 'utf-8')
    const result = await EditFileTool.call({ path: 'file.txt', search: 'line2', replace: 'replaced' }, ctx)
    expect(result.error).toBeUndefined()
    const content = readFileSync(join(TEST_DIR, 'file.txt'), 'utf-8')
    expect(content).toBe('line1\nreplaced\nline3')
  })

  it('should return error when oldText not found', async () => {
    writeFileSync(join(TEST_DIR, 'file.txt'), 'hello world', 'utf-8')
    const result = await EditFileTool.call({ path: 'file.txt', search: 'notfound', replace: 'x' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('not found')
  })

  it('should return error for non-existent file', async () => {
    const result = await EditFileTool.call({ path: 'missing.txt', search: 'a', replace: 'b' }, ctx)
    expect(result.error).toBeDefined()
  })

  it('should be destructive', () => {
    expect(EditFileTool.isDestructive()).toBe(true)
  })
})
