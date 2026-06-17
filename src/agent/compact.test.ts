/**
 * Auto-compact 测试
 */
import { describe, it, expect } from 'bun:test'
import {
  estimateTokens,
  estimateMessageTokens,
  shouldCompact,
  groupIntoRounds,
  microcompact,
  compactMessages,
} from './compact'
import type { Message } from './types'

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should estimate latin text', () => {
    const text = 'a'.repeat(400)
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThanOrEqual(90)
    expect(tokens).toBeLessThanOrEqual(110)
  })

  it('should estimate CJK text at ~1 token per char (conservative)', () => {
    const text = '中'.repeat(30)
    const tokens = estimateTokens(text)
    expect(tokens).toBe(30)
  })
})

describe('estimateMessageTokens', () => {
  it('should estimate user message', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello world' }]
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(0)
  })

  it('should estimate assistant with tool calls', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [{ id: '1', name: 'readFile', input: { path: 'test.ts' } }],
      },
    ]
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(estimateMessageTokens([{ role: 'assistant', content: 'ok' }]))
  })

  it('should estimate tool result', () => {
    const msgs: Message[] = [
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: { data: 'content' } },
    ]
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(0)
  })
})

describe('shouldCompact', () => {
  it('should return false under threshold', () => {
    const msgs: Message[] = [{ role: 'user', content: 'short' }]
    expect(shouldCompact(msgs, 1000)).toBe(false)
  })

  it('should return true over threshold', () => {
    const msgs: Message[] = [{ role: 'user', content: 'x'.repeat(10_000) }]
    expect(shouldCompact(msgs, 100)).toBe(true)
  })
})

describe('groupIntoRounds', () => {
  it('should group messages by user boundary', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: {} },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]
    const rounds = groupIntoRounds(msgs)
    expect(rounds.length).toBe(2)
    expect(rounds[0].length).toBe(3)
    expect(rounds[1].length).toBe(2)
  })

  it('should handle single user message', () => {
    const msgs: Message[] = [{ role: 'user', content: 'q' }]
    const rounds = groupIntoRounds(msgs)
    expect(rounds.length).toBe(1)
  })

  it('should handle empty array', () => {
    const rounds = groupIntoRounds([])
    expect(rounds.length).toBe(0)
  })
})

describe('microcompact', () => {
  it('should not compact recent rounds', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: { data: 'old content' } },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]
    const result = microcompact(msgs, 2)
    const toolMsg = result.find((m) => m.role === 'tool' && m.toolCallId === '1') as any
    expect(toolMsg).toBeDefined()
    expect(toolMsg.result).toEqual({ data: 'old content' })
  })

  it('should compact old tool results', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: { data: 'old content that is very long '.repeat(20) } },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', toolCallId: '2', toolName: 'readFile', result: { data: 'new content that is very long '.repeat(20) } },
    ]
    const result = microcompact(msgs, 1)

    const oldTool = result.find((m) => m.role === 'tool' && m.toolCallId === '1') as any
    const newTool = result.find((m) => m.role === 'tool' && m.toolCallId === '2') as any

    expect(oldTool).toBeDefined()
    expect(typeof oldTool.result).toBe('string')
    expect(oldTool.result as string).toContain('Compacted')

    expect(newTool).toBeDefined()
    expect(newTool.result).toEqual({ data: 'new content that is very long '.repeat(20) })
  })

  it('should keep user and assistant messages intact', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: { data: 'x' } },
    ]
    const result = microcompact(msgs, 0)

    const user = result.find((m) => m.role === 'user')
    const assistant = result.find((m) => m.role === 'assistant')
    expect(user!.content).toBe('q1')
    expect(assistant!.content).toBe('a1')
  })
})

describe('compactMessages', () => {
  it('should not compact when under threshold', async () => {
    const msgs: Message[] = [{ role: 'user', content: 'short' }]
    const result = await compactMessages(msgs, undefined, { threshold: 1000 })
    expect(result.wasCompacted).toBe(false)
    expect(result.method).toBe('none')
  })

  it('should microcompact when over threshold', async () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', toolCallId: '1', toolName: 'readFile', result: { data: 'old content that is very long '.repeat(20) } },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', toolCallId: '2', toolName: 'readFile', result: { data: 'new content that is very long '.repeat(20) } },
    ]
    const result = await compactMessages(msgs, undefined, { threshold: 1, keepRecentRounds: 1 })
    expect(result.wasCompacted).toBe(true)
    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter)
  })

  it('should handle empty messages', async () => {
    const result = await compactMessages([], undefined, { threshold: 1000 })
    expect(result.wasCompacted).toBe(false)
    expect(result.messages).toEqual([])
  })
})
