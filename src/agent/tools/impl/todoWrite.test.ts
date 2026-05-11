/**
 * TodoWriteTool 测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { TodoWriteTool } from './todoWrite'
import type { ToolContext } from '../Tool'

const TASKS_DIR = join(homedir(), '.note_agent', 'tasks')

describe('TodoWriteTool', () => {
  beforeEach(() => {
    // Clean tasks dir
    if (existsSync(TASKS_DIR)) {
      const files = readdirSync(TASKS_DIR)
      for (const f of files) {
        if (f.endsWith('.json')) {
          rmSync(join(TASKS_DIR, f))
        }
      }
    }
  })

  const ctx: ToolContext = { workspacePath: process.cwd(), mode: 'ask' }

  it('should list empty tasks', async () => {
    const result = await TodoWriteTool.call({ action: 'list' }, ctx)
    expect(result.data).toBe('No tasks.')
  })

  it('should add a task', async () => {
    const result = await TodoWriteTool.call({ action: 'add', text: 'Fix bug in auth' }, ctx)
    expect(result.data).toContain('Fix bug in auth')
    expect(result.data).toContain('[ ] Fix bug in auth')
    expect(result.data).toContain('Progress:')
  })

  it('should require text for add', async () => {
    const result = await TodoWriteTool.call({ action: 'add' }, ctx)
    expect(result.error).toBe('Task text is required for add action')
  })

  it('should complete a task', async () => {
    await TodoWriteTool.call({ action: 'add', text: 'Task 1' }, ctx)
    const result = await TodoWriteTool.call({ action: 'complete', index: 1 }, ctx)
    expect(result.data).toContain('[x] Task 1')
    expect(result.data).toContain('Progress: 1/1 completed')
  })

  it('should reject invalid index for complete', async () => {
    const result = await TodoWriteTool.call({ action: 'complete', index: 999 }, ctx)
    expect(result.error).toBe('Invalid task index: 999')
  })

  it('should require index for complete', async () => {
    const result = await TodoWriteTool.call({ action: 'complete' }, ctx)
    expect(result.error).toBe('Task index is required for complete action')
  })

  it('should remove a task', async () => {
    await TodoWriteTool.call({ action: 'add', text: 'Task A' }, ctx)
    await TodoWriteTool.call({ action: 'add', text: 'Task B' }, ctx)
    const result = await TodoWriteTool.call({ action: 'remove', index: 1 }, ctx)
    expect(result.data).toContain('Removed: Task A')
    expect(result.data).not.toContain('[ ] Task A')
    expect(result.data).toContain('[ ] Task B')
  })

  it('should clear all tasks', async () => {
    await TodoWriteTool.call({ action: 'add', text: 'Task 1' }, ctx)
    await TodoWriteTool.call({ action: 'add', text: 'Task 2' }, ctx)
    const result = await TodoWriteTool.call({ action: 'clear' }, ctx)
    expect(result.data).toBe('All tasks cleared.')

    const list = await TodoWriteTool.call({ action: 'list' }, ctx)
    expect(list.data).toBe('No tasks.')
  })

  it('should validate input schema', () => {
    expect(() => TodoWriteTool.validateInput({ action: 'invalid' })).toThrow()
    expect(() => TodoWriteTool.validateInput({ action: 'add', text: 'ok' })).not.toThrow()
  })
})
