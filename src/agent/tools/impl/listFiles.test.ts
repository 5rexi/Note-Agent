/**
 * ListFilesTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { ListFilesTool } from './listFiles'
import type { ToolContext } from '../Tool'

const TEST_DIR = join(process.cwd(), 'test-listfiles')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'explore' }

describe('ListFilesTool', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should list files in root', async () => {
    writeFileSync(join(TEST_DIR, 'a.txt'), 'a', 'utf-8')
    writeFileSync(join(TEST_DIR, 'b.txt'), 'b', 'utf-8')

    const result = await ListFilesTool.call({ path: '.' }, ctx)
    expect(result.error).toBeUndefined()
    const data = result.data as string
    expect(data).toContain('a.txt')
    expect(data).toContain('b.txt')
  })

  it('should list files in subdirectory', async () => {
    mkdirSync(join(TEST_DIR, 'sub'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'sub', 'nested.txt'), 'nested', 'utf-8')

    const result = await ListFilesTool.call({ path: 'sub' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as string)).toContain('nested.txt')
  })

  it('should return error for non-existent path', async () => {
    const result = await ListFilesTool.call({ path: 'nonexistent' }, ctx)
    expect(result.error).toBeDefined()
  })

  it('should handle empty directory', async () => {
    mkdirSync(join(TEST_DIR, 'empty'), { recursive: true })
    const result = await ListFilesTool.call({ path: 'empty' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as string).length).toBe(0)
  })
})
