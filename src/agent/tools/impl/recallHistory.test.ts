/**
 * recallHistory tool — exercised against a mock global.__db (the real Database
 * lives in main/db.ts and pulls in electron, so it can't be imported under bun).
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { RecallHistoryTool } from './recallHistory'

const ctx = { workspacePath: '/ws', mode: 'execute' as const, sessionId: 'sess-1' }

function installMockDb(over: Partial<any> = {}) {
  ;(global as any).__db = {
    searchMessages: (q: string, opts: any) => [
      { session_id: opts.sessionId ?? 'sess-2', role: 'assistant', content: `answer about ${q}`, created_at: 1700000000, title: 'Past chat' },
    ],
    getSessionSummaries: () => [
      { id: 'sess-2', title: 'Past chat', summary: 'discussed APA citations', created_at: 1699999999 },
    ],
    ...over,
  }
}

afterEach(() => { delete (global as any).__db })

describe('RecallHistoryTool', () => {
  it('permission is allow and read-only', () => {
    expect(RecallHistoryTool.checkPermissions({ query: 'x', scope: 'session' }, ctx).result).toBe('allow')
    expect(RecallHistoryTool.isReadOnly()).toBe(true)
  })

  it('session scope returns matches', async () => {
    installMockDb()
    const r = await RecallHistoryTool.call({ query: 'citations', scope: 'session' }, ctx)
    expect(r.error).toBeUndefined()
    expect(r.data).toContain('Matches for "citations"')
    expect(r.data).toContain('answer about citations')
  })

  it('workspace scope shows the summary index first', async () => {
    installMockDb()
    const r = await RecallHistoryTool.call({ query: 'APA', scope: 'workspace' }, ctx)
    expect(r.data).toContain('## Conversations')
    expect(r.data).toContain('discussed APA citations')
  })

  it('reports no matches cleanly', async () => {
    installMockDb({ searchMessages: () => [] })
    const r = await RecallHistoryTool.call({ query: 'nothing', scope: 'session' }, ctx)
    expect(r.data).toContain('No matches')
  })

  it('degrades gracefully without a db', async () => {
    const r = await RecallHistoryTool.call({ query: 'x', scope: 'session' }, ctx)
    expect(r.error).toBeDefined()
  })
})
