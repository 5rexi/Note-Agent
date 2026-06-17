/**
 * ExecuteCommandTool 全面测试
 */
import { describe, it, expect } from 'bun:test'
import { ExecuteCommandTool } from './executeCommand'
import type { ToolContext } from '../Tool'

const ctx: ToolContext = { workspacePath: process.cwd(), mode: 'execute' }

describe('ExecuteCommandTool', () => {
  it('should execute echo command', async () => {
    const result = await ExecuteCommandTool.call({ command: 'echo hello' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as any).stdout.trim()).toBe('hello')
  })

  it('should execute pwd', async () => {
    const result = await ExecuteCommandTool.call({ command: 'pwd' }, ctx)
    expect(result.error).toBeUndefined()
    expect((result.data as any).stdout.trim().length).toBeGreaterThan(0)
  })

  it('should return error for invalid command', async () => {
    const result = await ExecuteCommandTool.call({ command: 'this_command_does_not_exist_12345' }, ctx)
    expect(result.error).toBeDefined()
  })

  it('should validate input schema', () => {
    expect(() => ExecuteCommandTool.validateInput({ command: 'ls' })).not.toThrow()
    expect(() => ExecuteCommandTool.validateInput({})).toThrow()
  })

  it('should be destructive and not read-only', () => {
    // Running arbitrary commands is destructive by definition.
    expect(ExecuteCommandTool.isDestructive()).toBe(true)
    expect(ExecuteCommandTool.isReadOnly()).toBe(false)
  })
})
