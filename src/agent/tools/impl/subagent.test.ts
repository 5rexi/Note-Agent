/**
 * SubagentTool 测试
 */
import { describe, it, expect } from 'bun:test'
import { summarizeSubagentResult } from './subagent'
import type { Message } from '../../types'

describe('summarizeSubagentResult', () => {
  it('should summarize empty messages', () => {
    const summary = summarizeSubagentResult([])
    expect(summary).toContain('Subagent Result')
    expect(summary).toContain('Total Messages:** 0')
  })

  it('should include the first user message as task', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Find all React components' },
      { role: 'assistant', content: 'Found 5 components' },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary).toContain('Find all React components')
    expect(summary).toContain('Final Answer:')
    expect(summary).toContain('Found 5 components')
  })

  it('should include tool usage', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Search for files' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: '1', name: 'globSearch', input: {} }] },
      { role: 'tool', toolCallId: '1', toolName: 'globSearch', result: { data: ['a.ts', 'b.ts'] } },
    ]
    const summary = summarizeSubagentResult(msgs)
    expect(summary).toContain('Tools Used')
    expect(summary).toContain('globSearch')
  })

  it('should deduplicate tool names', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'task' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: {} },
      { role: 'tool', toolCallId: '2', toolName: 'readFile', result: {} },
      { role: 'tool', toolCallId: '3', toolName: 'readFile', result: {} },
    ]
    const summary = summarizeSubagentResult(msgs)
    // Should only list readFile once
    const matches = summary.match(/readFile/g)
    expect(matches?.length).toBe(1)
  })

  it('should truncate long messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'x'.repeat(1000) },
      { role: 'assistant', content: 'y'.repeat(3000) },
    ]
    const summary = summarizeSubagentResult(msgs)
    // Should be truncated in task but still present
    expect(summary.length).toBeLessThan(4000)
  })
})
