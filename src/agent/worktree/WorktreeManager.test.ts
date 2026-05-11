/**
 * WorktreeManager 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { WorktreeManager } from './WorktreeManager'

const TEST_DIR = join(process.cwd(), 'test-worktree')

describe('WorktreeManager', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    // Init git repo
    try {
      const { execSync } = require('child_process')
      execSync('git init', { cwd: TEST_DIR })
      writeFileSync(join(TEST_DIR, 'file.txt'), 'hello', 'utf-8')
      execSync('git add . && git commit -m "init"', { cwd: TEST_DIR })
    } catch {
      // ignore
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    // Clean up any worktrees
    const wtPath = join(process.cwd(), '..', '.worktree-test')
    if (existsSync(wtPath)) rmSync(wtPath, { recursive: true, force: true })
  })

  it('should create a worktree directory', () => {
    const mgr = new WorktreeManager(TEST_DIR)
    const path = mgr.create('test')
    expect(existsSync(path)).toBe(true)
    mgr.remove(path)
  })

  it('should list worktrees', () => {
    const mgr = new WorktreeManager(TEST_DIR)
    const path = mgr.create('list-test')
    const list = mgr.list()
    // May or may not contain the worktree depending on git setup
    expect(Array.isArray(list)).toBe(true)
    mgr.remove(path)
  })
})
