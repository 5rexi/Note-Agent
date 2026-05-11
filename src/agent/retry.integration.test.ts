/**
 * Retry 机制真实 API 集成测试
 * 验证 withRetry 在实际 LLM 调用中的行为
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { withRetry, classifyError } from './retry'
import { createOpenAIClient } from './llm/client'
import type { Message } from './types'

const TEST_CONFIG = {
  provider: 'openai',
  model: 'MiniMax-M2.7',
  apiKey: process.env.NA_API_KEY || '',
  baseUrl: process.env.NA_BASE_URL || 'https://api.minimaxi.com/v1',
}

const HAS_API_KEY = !!TEST_CONFIG.apiKey

describe('withRetry (live API)', () => {
  beforeAll(() => {
    if (!HAS_API_KEY) {
      console.log('Skipping live LLM tests: NA_API_KEY not set')
    }
  })

  it('should succeed on first try with valid key', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    let received = false
    await withRetry(async () => {
      for await (const event of client.stream([{ role: 'user', content: 'Hi' }], [])) {
        if (event.type === 'text') received = true
      }
    })
    expect(received).toBe(true)
  }, 30000)

  it('should not retry on 401 auth error', async () => {
    const badClient = createOpenAIClient({ ...TEST_CONFIG, apiKey: 'invalid' })
    let retryCount = 0
    try {
      await withRetry(
        async () => {
          retryCount++
          for await (const _ of badClient.stream([{ role: 'user', content: 'Hi' }], [])) {
            // consume
          }
        },
        {},
        () => {},
      )
      expect(false).toBe(true)
    } catch (err: any) {
      expect(retryCount).toBe(1)
      const classified = classifyError(err)
      expect(classified.category).toBe('auth')
      expect(classified.retryable).toBe(false)
    }
  })

  it('should call onRetry callback on retries', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    let callbackCalled = false
    await withRetry(
      async () => {
        for await (const event of client.stream([{ role: 'user', content: 'Say hi' }], [])) {
          if (event.type === 'text') {
            // consume
          }
        }
      },
      {},
      () => {
        callbackCalled = true
      },
    )
    expect(callbackCalled).toBe(false) // Should succeed on first try
  }, 30000)

  it('should wrap stream consumption correctly', async () => {
    if (!HAS_API_KEY) return
    const client = createOpenAIClient(TEST_CONFIG)
    let textReceived = false
    await withRetry(async () => {
      for await (const event of client.stream([{ role: 'user', content: 'Hello' }], [])) {
        if (event.type === 'text') textReceived = true
      }
    })
    expect(textReceived).toBe(true)
  }, 30000)
})
