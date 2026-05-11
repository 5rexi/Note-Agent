/**
 * Hooks 系统测试
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { hookRegistry, type Hook } from './types'

describe('HookRegistry', () => {
  beforeEach(() => {
    // Unregister all hooks for clean state
    for (const h of hookRegistry.getHooksFor('PreToolUse')) {
      hookRegistry.unregister(h.name)
    }
    for (const h of hookRegistry.getHooksFor('PostToolUse')) {
      hookRegistry.unregister(h.name)
    }
    for (const h of hookRegistry.getHooksFor('SessionStart')) {
      hookRegistry.unregister(h.name)
    }
  })

  it('should register and emit hooks', async () => {
    let called = false
    const hook: Hook = {
      name: 'test-hook',
      events: ['PreToolUse'],
      handler: async (ctx) => {
        called = true
        expect(ctx.event).toBe('PreToolUse')
      },
    }
    hookRegistry.register(hook)
    await hookRegistry.emit('PreToolUse', { toolName: 'test' })
    expect(called).toBe(true)
  })

  it('should call multiple hooks in priority order', async () => {
    const order: number[] = []
    hookRegistry.register({
      name: 'low-priority',
      events: ['PreToolUse'],
      priority: 1,
      handler: async () => { order.push(1) },
    })
    hookRegistry.register({
      name: 'high-priority',
      events: ['PreToolUse'],
      priority: 10,
      handler: async () => { order.push(10) },
    })
    await hookRegistry.emit('PreToolUse', {})
    expect(order).toEqual([10, 1])
  })

  it('should unregister hooks', () => {
    hookRegistry.register({
      name: 'to-remove',
      events: ['PreToolUse'],
      handler: async () => {},
    })
    expect(hookRegistry.getHooksFor('PreToolUse').length).toBeGreaterThan(0)
    hookRegistry.unregister('to-remove')
    expect(hookRegistry.getHooksFor('PreToolUse').filter((h) => h.name === 'to-remove').length).toBe(0)
  })

  it('should not throw when emitting with no hooks', async () => {
    await expect(hookRegistry.emit('Stop', {})).resolves.toBeUndefined()
  })

  it('should support all 12+ event types', () => {
    const events = [
      'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact',
      'SessionStart', 'SessionPause', 'SessionResume', 'CompactBoundary',
      'WorktreeCreate', 'WorktreeRemove', 'Notification', 'Stop', 'SubagentStop',
    ] as const

    for (const event of events) {
      hookRegistry.register({
        name: `test-${event}`,
        events: [event],
        handler: async () => {},
      })
      expect(hookRegistry.getHooksFor(event).length).toBeGreaterThan(0)
      hookRegistry.unregister(`test-${event}`)
    }
  })
})
