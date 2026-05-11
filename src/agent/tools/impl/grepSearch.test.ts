/**
 * GrepSearchTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { GrepSearchTool } from './grepSearch'
import type { ToolContext } from '../Tool'

const TEST_DIR = join(process.cwd(), 'test-grep')
const ctx: ToolContext = { workspacePath: TEST_DIR, mode: 'explore' }

describe('GrepSearchTool', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(join(TEST_DIR, 'a.ts'), 'const x = 1;\nconst y = 2;', 'utf-8')
    writeFileSync(join(TEST_DIR, 'b.ts'), 'function foo() {}\nconst z = 3;', 'utf-8')
    writeFileSync(join(TEST_DIR, 'readme.md'), '# Hello\nWorld', 'utf-8')
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should find text pattern', async () => {
    const result = await GrepSearchTool.call({ pattern: 'const', path: '.' }, ctx)
    expect(result.error).toBeUndefined()
    const matches = result.data as Array<{ file: string; line: number; content: string }>
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('should find regex pattern', async () => {
    const result = await GrepSearchTool.call({ pattern: 'function\\s+\\w+', path: '.' }, ctx)
    expect(result.error).toBeUndefined()
    const matches = result.data as Array<{ file: string; line: number; content: string }>
    expect(matches.some((m) => m.content.includes('function foo'))).toBe(true)
  })

  it('should return empty for no matches', async () => {
    const result = await GrepSearchTool.call({ pattern: 'NOTFOUND12345', path: '.' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as any[]).length).toBe(0)
  })

  it('should handle invalid regex gracefully', async () => {
    const result = await GrepSearchTool.call({ pattern: '[invalid', path: '.' }, ctx)
    expect(result.error).toBeDefined()
  })
})
