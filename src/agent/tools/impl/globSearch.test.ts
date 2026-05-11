/**
 * GlobSearchTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { GlobSearchTool } from './globSearch'
import type { ToolContext } from '../Tool'

const TEST_DIR = join(process.cwd(), 'test-glob')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'explore' }

describe('GlobSearchTool', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(join(TEST_DIR, 'a.ts'), '', 'utf-8')
    writeFileSync(join(TEST_DIR, 'b.ts'), '', 'utf-8')
    writeFileSync(join(TEST_DIR, 'a.js'), '', 'utf-8')
    writeFileSync(join(TEST_DIR, 'readme.md'), '', 'utf-8')
    mkdirSync(join(TEST_DIR, 'sub'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'sub', 'c.ts'), '', 'utf-8')
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should find *.ts files', async () => {
    const result = await GlobSearchTool.call({ pattern: '*.ts' }, ctx)
    expect(result.error).toBeUndefined()
    const files = result.data as string[]
    expect(files.some((f) => f.includes('a.ts'))).toBe(true)
    expect(files.some((f) => f.includes('b.ts'))).toBe(true)
  })

  it('should find files recursively', async () => {
    const result = await GlobSearchTool.call({ pattern: '**/*.ts' }, ctx)
    expect(result.error).toBeUndefined()
    const files = result.data as string[]
    expect(files.length).toBeGreaterThanOrEqual(3)
    expect(files.some((f) => f.includes('sub/c.ts'))).toBe(true)
  })

  it('should return empty array for no matches', async () => {
    const result = await GlobSearchTool.call({ pattern: '*.py' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as string[]).length).toBe(0)
  })

  it('should be read-only', () => {
    expect(GlobSearchTool.isReadOnly()).toBe(true)
    expect(GlobSearchTool.isConcurrencySafe()).toBe(true)
  })
})
