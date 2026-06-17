/**
 * UpdateMemoryTool — persist long-lived memory across the 3-layer system.
 *
 * Scopes:
 *  - 'session': notes for the current chat (auto-allowed, low blast radius).
 *  - 'global' : user preferences that apply across ALL projects. High blast
 *    radius, so writes require user confirmation (checkPermissions → 'ask').
 *
 * Workspace memory (NOTEAGENT.md) is intentionally NOT writable here — it is a
 * human-authored file that is only read into context.
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { appendSessionMemory } from '../../memory'
import { setKvMemory, deleteKvMemory } from '../../persistence'

const GLOBAL_SCOPE = 'global'

const inputSchema = z.object({
  scope: z.enum(['session', 'global']).describe(
    "'session' = note for this chat only; 'global' = user preference across all projects (asks for confirmation).",
  ),
  key: z.string().describe('Short topic/slug for the fact. Writing the same key again replaces the old value.'),
  value: z.string().describe('The fact to remember. Keep it concise.'),
  action: z.enum(['set', 'delete']).optional().describe("'set' (default) stores/updates; 'delete' removes the key (global only)."),
})

type Input = z.infer<typeof inputSchema>

export const UpdateMemoryTool: Tool<Input, string> = {
  name: 'updateMemory',
  description: `Persist something worth remembering beyond the current message history.

## When to Use
- The user states a durable preference ("always cite in APA", "I write in Chinese") → scope 'global'
- A key decision or fact that should survive context compaction in THIS chat → scope 'session'

## Scopes
- session: remembered for this chat only. Saved automatically.
- global: user preference applied to EVERY project. Requires user confirmation before saving.

## Notes
- Use a stable \`key\` (topic). Writing the same key again UPDATES it — use this to correct stale facts.
- Do NOT store transient task state here — use todoWrite for that.
- Do NOT store secrets or large content.`,
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions(input) {
    // Global memory affects all future projects — confirm before writing.
    if (input.scope === GLOBAL_SCOPE) {
      const verb = input.action === 'delete' ? 'Delete' : 'Save'
      return { result: 'ask', description: `${verb} global memory "${input.key}"` }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    const action = input.action ?? 'set'

    if (input.scope === GLOBAL_SCOPE) {
      if (action === 'delete') {
        deleteKvMemory(GLOBAL_SCOPE, input.key)
        return { data: `Deleted global memory: ${input.key}` }
      }
      setKvMemory(GLOBAL_SCOPE, input.key, input.value)
      return { data: `Saved global memory: ${input.key}` }
    }

    // Session scope
    if (action === 'delete') {
      // Session memory is an append log without keys; nothing to delete by key.
      return { data: 'Session memory is append-only; nothing to delete.' }
    }
    appendSessionMemory(ctx.sessionId ?? 'default', `${input.key}: ${input.value}`)
    return { data: `Saved session memory: ${input.key}` }
  },

  renderToolUse(input) {
    const action = input.action ?? 'set'
    return `Memory ${action} [${input.scope}]: ${input.key}`
  },
}
