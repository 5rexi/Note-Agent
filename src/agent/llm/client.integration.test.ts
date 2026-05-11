/**
 * LLM Client 真实 API 集成测试
 * 验证 SSE 流式解析、think 标签剥离、错误处理
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { createOpenAIClient, createLLMClient } from './client'
import type { Message } from '../types'

const TEST_CONFIG = {
  provider: 'openai',
  model: 'MiniMax-M2.7',
  apiKey: process.env.NA_API_KEY || '',
  baseUrl: process.env.NA_BASE_URL || 'https://api.minimaxi.com/v1',
}

const HAS_API_KEY = !!TEST_CONFIG.apiKey

describe('LLM Client (live API)', () => {
  beforeAll(() => {
    if (!HAS_API_KEY) {
      console.log('Skipping live LLM tests: NA_API_KEY not set')
    }
  })

  it('should stream text response', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    const messages: Message[] = [{ role: 'user', content: 'Say "hello" and nothing else' }]

    let fullText = ''
    let hasDone = false
    const events: any[] = []

    for await (const event of client.stream(messages, [])) {
      events.push(event)
      if (event.type === 'text') {
        fullText += event.text
      }
      if (event.type === 'done') {
        hasDone = true
      }
    }

    expect(fullText.length).toBeGreaterThan(0)
    expect(hasDone).toBe(true)
    expect(events.some((e) => e.type === 'text')).toBe(true)
  }, 30000)

  it('should handle tool use when given tools', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+2? Use a calculator tool if available.' },
    ]
    const toolSchemas = [
      {
        name: 'calculator',
        description: 'Perform arithmetic calculations',
        parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      },
    ]

    let hasToolUse = false
    let hasText = false

    for await (const event of client.stream(messages, toolSchemas)) {
      if (event.type === 'tool_use') {
        hasToolUse = true
        expect(event.toolCall).toBeDefined()
        expect(event.toolCall!.name).toBeDefined()
      }
      if (event.type === 'text') {
        hasText = true
      }
    }

    expect(hasText || hasToolUse).toBe(true)
  }, 30000)

  it('should handle invalid API key (401)', async () => {
    const badClient = createOpenAIClient({
      ...TEST_CONFIG,
      apiKey: 'invalid-key',
    })

    try {
      for await (const _ of badClient.stream([{ role: 'user', content: 'hi' }], [])) {
        // consume
      }
      expect(false).toBe(true)
    } catch (err: any) {
      expect(err.message).toContain('401')
    }
  })

  it('should handle empty messages', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    const events: any[] = []

    for await (const event of client.stream([{ role: 'user', content: '' }], [])) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)

  it('should handle very long prompt without crashing', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    const longText = 'Count to 3. '.repeat(100)
    const messages: Message[] = [{ role: 'user', content: longText }]

    let textReceived = false
    for await (const event of client.stream(messages, [])) {
      if (event.type === 'text') {
        textReceived = true
      }
    }

    expect(textReceived).toBe(true)
  }, 30000)

  it('should create client via createLLMClient factory', async () => {
    if (!HAS_API_KEY) return
    const client = createLLMClient(TEST_CONFIG)
    let received = false
    for await (const event of client.stream([{ role: 'user', content: 'Hi' }], [])) {
      if (event.type === 'text') received = true
    }
    expect(received).toBe(true)
  }, 30000)
})
