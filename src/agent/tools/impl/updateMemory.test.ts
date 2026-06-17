/**
 * UpdateMemoryTool 测试
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { UpdateMemoryTool } from './updateMemory'
import { getKvMemories, deleteKvMemory } from '../../persistence'
import { getSessionMemory, clearSessionMemory } from '../../memory'

const ctx = { workspacePath: process.cwd(), mode: 'execute' as const, sessionId: '__test_um_session__' }
const G_KEY = '__test_um_global__'

afterEach(() => {
  deleteKvMemory('global', G_KEY)
  clearSessionMemory(ctx.sessionId)
})

describe('UpdateMemoryTool.checkPermissions', () => {
  it('asks before writing global memory', () => {
    const perm = UpdateMemoryTool.checkPermissions({ scope: 'global', key: G_KEY, value: 'x' }, ctx)
    expect(perm.result).toBe('ask')
  })

  it('allows session memory without confirmation', () => {
    const perm = UpdateMemoryTool.checkPermissions({ scope: 'session', key: 'k', value: 'x' }, ctx)
    expect(perm.result).toBe('allow')
  })
})

describe('UpdateMemoryTool.call', () => {
  it('sets and supersedes global memory by key', async () => {
    await UpdateMemoryTool.call({ scope: 'global', key: G_KEY, value: 'first' }, ctx)
    await UpdateMemoryTool.call({ scope: 'global', key: G_KEY, value: 'second' }, ctx)
    const entries = getKvMemories('global').filter((e) => e.key === G_KEY)
    expect(entries.length).toBe(1)
    expect(entries[0].value).toBe('second')
  })

  it('deletes global memory', async () => {
    await UpdateMemoryTool.call({ scope: 'global', key: G_KEY, value: 'x' }, ctx)
    await UpdateMemoryTool.call({ scope: 'global', key: G_KEY, value: '', action: 'delete' }, ctx)
    expect(getKvMemories('global').some((e) => e.key === G_KEY)).toBe(false)
  })

  it('appends session memory', async () => {
    await UpdateMemoryTool.call({ scope: 'session', key: 'decision', value: 'use TypeScript' }, ctx)
    expect(getSessionMemory(ctx.sessionId)).toContain('use TypeScript')
  })
})
