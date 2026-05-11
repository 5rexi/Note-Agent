/**
 * Hooks 系统 — 生命周期扩展点
 * 参考设计文档第11章：12+ 种 Hook 事件
 */

export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'SessionPause'
  | 'SessionResume'
  | 'CompactBoundary'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop'
  | 'CoordinatorInitialized'

export interface HookContext {
  event: HookEventType
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  sessionId?: string
  message?: string
  [key: string]: unknown
}

export type HookHandler = (ctx: HookContext) => void | Promise<void>

export interface Hook {
  name: string
  events: HookEventType[]
  handler: HookHandler
  /** 优先级：数字越大越先执行 */
  priority?: number
}

class HookRegistry {
  private hooks = new Map<HookEventType, Hook[]>()

  register(hook: Hook): void {
    for (const event of hook.events) {
      const list = this.hooks.get(event) || []
      list.push(hook)
      list.sort((a, b) => (b.priority || 0) - (a.priority || 0))
      this.hooks.set(event, list)
    }
  }

  unregister(name: string): void {
    for (const [event, list] of this.hooks) {
      this.hooks.set(
        event,
        list.filter((h) => h.name !== name),
      )
    }
  }

  async emit(event: HookEventType, ctx: Omit<HookContext, 'event'>): Promise<void> {
    const list = this.hooks.get(event) || []
    for (const hook of list) {
      try {
        await hook.handler({ ...ctx, event })
      } catch (err) {
        console.error(`[Hook Error] ${hook.name}:`, err)
      }
    }
  }

  getHooksFor(event: HookEventType): Hook[] {
    return [...(this.hooks.get(event) || [])]
  }
}

export const hookRegistry = new HookRegistry()
