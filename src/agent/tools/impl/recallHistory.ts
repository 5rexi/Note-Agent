/**
 * recallHistory — search the persisted conversation transcript for detail that
 * compaction dropped, or anything from an earlier / past conversation.
 *
 * The full transcript is stored in the app DB (main/db.ts, `global.__db`),
 * independent of context compaction. This tool reads it back on demand so the
 * model can recover a detail without permanently re-bloating the context.
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

interface RecallDb {
  searchMessages(
    query: string,
    opts: { sessionId?: string; workspacePath?: string; limit?: number },
  ): Array<{ session_id: string; role: string; content: string; created_at: number; title?: string }>
  getSessionSummaries(
    workspacePath: string,
  ): Array<{ id: string; title: string; summary: string | null; created_at: number }>
}

function getRecallDb(): RecallDb | null {
  const db = (global as any).__db
  if (db && typeof db.searchMessages === 'function' && typeof db.getSessionSummaries === 'function') {
    return db as RecallDb
  }
  return null
}

const inputSchema = z.object({
  query: z.string().describe('What to look for — keywords from the lost detail or past discussion.'),
  scope: z.enum(['session', 'workspace']).describe("'session' = this chat only; 'workspace' = this and past chats in the workspace."),
  sessionId: z.string().optional().describe('Optional: restrict the search to a specific past conversation id (from the summary index).'),
})
type Input = z.infer<typeof inputSchema>

const fmtDate = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')
const snippet = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s)

export const RecallHistoryTool: Tool<Input, string> = {
  name: 'recallHistory',
  description: 'Search earlier conversation transcript for a detail you no longer have in context (e.g. dropped by compaction) or from a past conversation. Prefer this over guessing or re-asking the user. scope="session" searches the current chat; scope="workspace" also searches past chats (and shows a summary index of them first).',
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },
  checkPermissions() { return { result: 'allow' } },
  validateInput(raw) { return inputSchema.parse(raw) },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    const db = getRecallDb()
    if (!db) {
      return { data: '', error: 'Conversation history search is not available in this environment.' }
    }

    const parts: string[] = []

    // Workspace scope: show the conversation summary index first so the model can
    // see which past conversations exist before drilling into snippets.
    if (input.scope === 'workspace' && !input.sessionId && ctx.workspacePath) {
      const summaries = db.getSessionSummaries(ctx.workspacePath)
      if (summaries.length > 0) {
        parts.push('## Conversations')
        for (const s of summaries.slice(0, 30)) {
          parts.push(`- [${s.id}] ${s.title} (${fmtDate(s.created_at)}): ${snippet(s.summary || '', 160)}`)
        }
      }
    }

    const opts = input.sessionId
      ? { sessionId: input.sessionId, limit: 20 }
      : input.scope === 'session'
        ? { sessionId: ctx.sessionId, limit: 20 }
        : { workspacePath: ctx.workspacePath, limit: 20 }

    const hits = (opts.sessionId || opts.workspacePath) ? db.searchMessages(input.query, opts) : []

    if (hits.length === 0) {
      parts.push(`\nNo matches for "${input.query}".`)
      return { data: parts.join('\n') }
    }

    parts.push(`\n## Matches for "${input.query}" (${hits.length})`)
    for (const h of hits) {
      const where = h.title ? `${h.title} · ` : ''
      parts.push(`- ${where}${h.role} (${fmtDate(h.created_at)}): ${snippet(h.content)}`)
    }
    return { data: parts.join('\n') }
  },

  renderToolUse(input) {
    return `Recall (${input.scope}): "${input.query}"`
  },
}
