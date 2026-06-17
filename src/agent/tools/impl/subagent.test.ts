/**
 * SubagentTool 测试
 *
 * The subagent now returns a COMPACT report: the final model-authored answer
 * plus a one-line provenance note — not a replay of the execution history.
 */
import { describe, it, expect } from 'bun:test'
import { summarizeSubagentResult } from './subagent'
import type { Message } from '../../types'

describe('summarizeSubagentResult', () => {
  it('handles empty messages', () => {
    const summary = summarizeSubagentResult([])
    expect(summary).toContain('Subagent Result')
    expect(summary).toContain('no final summary')
  })

  it('returns the final assistant answer, not the step history', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Find all React components' },
      { role: 'assistant', content: 'Looking...', toolCalls: [{ id: '1', name: 'grepSearch', input: {} }] },
      { role: 'tool', toolCallId: '1', toolName: 'grepSearch', result: { data: 'x' } },
      { role: 'assistant', content: 'Found 5 components: A, B, C, D, E' },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary).toContain('Found 5 components')
    // The user task and intermediate chatter are NOT replayed into the parent.
    expect(summary).not.toContain('Find all React components')
    expect(summary).not.toContain('Looking...')
  })

  it('lists tools used as a one-line note', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'ok', toolCalls: [{ id: '1', name: 'globSearch', input: {} }] },
      { role: 'tool', toolCallId: '1', toolName: 'globSearch', result: { data: ['a.ts', 'b.ts'] } },
      { role: 'assistant', content: 'done' },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary).toContain('Tools used')
    expect(summary).toContain('globSearch')
  })

  it('deduplicates tool names and surfaces error count', () => {
    const msgs: Message[] = [
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: {} },
      { role: 'tool', toolCallId: '2', toolName: 'readFile', result: { error: 'nope' } },
      { role: 'tool', toolCallId: '3', toolName: 'readFile', result: {} },
      { role: 'assistant', content: 'summary' },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary.match(/readFile/g)?.length).toBe(1)
    expect(summary).toContain('1 tool error')
  })

  it('truncates a very long final answer', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'y'.repeat(5000) },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary.length).toBeLessThan(2100)
  })
})
