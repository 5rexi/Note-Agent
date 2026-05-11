/**
 * ReadFileTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { ReadFileTool } from './readFile'
import type { ToolContext } from '../Tool'

const TEST_DIR = join(process.cwd(), 'test-readfile')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'explore' }

describe('ReadFileTool', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should read a text file', async () => {
    writeFileSync(join(TEST_DIR, 'hello.txt'), 'Hello World', 'utf-8')
    const result = await ReadFileTool.call({ path: 'hello.txt' }, ctx)
    expect(result.error).toBeUndefined()
    expect(result.data).toBe('Hello World')
  })

  it('should read a JSON file', async () => {
    const json = { name: 'test', version: '1.0' }
    writeFileSync(join(TEST_DIR, 'config.json'), JSON.stringify(json, null, 2), 'utf-8')
    const result = await ReadFileTool.call({ path: 'config.json' }, ctx)
    expect(result.error).toBeUndefined()
    expect(JSON.parse(result.data as string)).toEqual(json)
  })

  it('should return error for non-existent file', async () => {
    const result = await ReadFileTool.call({ path: 'nonexistent.txt' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('not found')
  })

  it('should return error for directory', async () => {
    mkdirSync(join(TEST_DIR, 'subdir'), { recursive: true })
    const result = await ReadFileTool.call({ path: 'subdir' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('directory')
  })

  it('should skip binary files', async () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03])
    writeFileSync(join(TEST_DIR, 'binary.bin'), buf)
    const result = await ReadFileTool.call({ path: 'binary.bin' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Binary')
  })

  it('should handle empty file', async () => {
    writeFileSync(join(TEST_DIR, 'empty.txt'), '', 'utf-8')
    const result = await ReadFileTool.call({ path: 'empty.txt' }, ctx)
    expect(result.error).toBeUndefined()
    expect(result.data).toBe('')
  })

  it('should handle large file', async () => {
    const content = 'x'.repeat(100_000)
    writeFileSync(join(TEST_DIR, 'large.txt'), content, 'utf-8')
    const result = await ReadFileTool.call({ path: 'large.txt' }, ctx)
    expect(result.error).toBeUndefined()
    expect(result.data).toBe(content)
  })

  it('should validate input schema', () => {
    expect(() => ReadFileTool.validateInput({ path: 'ok' })).not.toThrow()
    expect(() => ReadFileTool.validateInput({})).toThrow()
  })

  it('should be read-only and concurrency-safe', () => {
    expect(ReadFileTool.isReadOnly()).toBe(true)
    expect(ReadFileTool.isConcurrencySafe()).toBe(true)
    expect(ReadFileTool.isDestructive()).toBe(false)
  })
})
