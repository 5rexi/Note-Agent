/**
 * FileStateCache 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { fileStateCache } from './FileStateCache'

const TEST_DIR = join(process.cwd(), 'test-filecache')

describe('FileStateCache', () => {
  beforeEach(() => {
    fileStateCache.clear()
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    fileStateCache.clear()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('should record file state', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    const state = fileStateCache.record(path)
    expect(state).toBeDefined()
    expect(state!.path).toBe(path)
    expect(state!.contentHash).toBeDefined()
  })

  it('should detect no change', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    fileStateCache.record(path)
    const result = fileStateCache.hasChanged(path)
    expect(result.changed).toBe(false)
  })

  it('should detect external modification', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    fileStateCache.record(path)
    // Simulate external edit
    writeFileSync(path, 'world', 'utf-8')
    const result = fileStateCache.hasChanged(path)
    expect(result.changed).toBe(true)
    expect(result.reason).toContain('modified externally')
  })

  it('should detect file deletion', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    fileStateCache.record(path)
    rmSync(path)
    const result = fileStateCache.hasChanged(path)
    expect(result.changed).toBe(true)
    expect(result.reason).toContain('deleted')
  })

  it('should throw on stale write', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    fileStateCache.record(path)
    writeFileSync(path, 'changed', 'utf-8')
    expect(() => fileStateCache.assertUnchanged(path)).toThrow('Stale write detected')
  })

  it('should allow editing when no prior record', () => {
    const path = join(TEST_DIR, 'file.txt')
    writeFileSync(path, 'hello', 'utf-8')
    // No record
    const result = fileStateCache.hasChanged(path)
    expect(result.changed).toBe(false)
  })
})
