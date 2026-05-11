/**
 * LLM Compact 真实 API 集成测试
 * 验证用真实 LLM 生成对话摘要
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { llmCompact, estimateMessageTokens } from './compact'
import type { Message, LLMConfig } from './types'

const TEST_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'MiniMax-M2.7',
  apiKey: process.env.NA_API_KEY || '',
  baseUrl: process.env.NA_BASE_URL || 'https://api.minimaxi.com/v1',
}

const HAS_API_KEY = !!TEST_LLM_CONFIG.apiKey

describe('llmCompact (live LLM)', () => {
  beforeAll(() => {
    if (!HAS_API_KEY) {
      console.log('Skipping live LLM tests: NA_API_KEY not set')
    }
  })

  it('should generate a summary of conversation', async () => {
    if (!HAS_API_KEY) return
    const messages: Message[] = [
      { role: 'user', content: 'I want to build a React app with TypeScript and Vite.' },
      { role: 'assistant', content: 'Great choice! Let me help you set that up.' },
      { role: 'user', content: 'Also, I need routing. What do you recommend?' },
      { role: 'assistant', content: 'React Router v6 is the standard for routing in React apps.' },
      { role: 'user', content: 'Should I use Zustand or Redux for state management?' },
      { role: 'assistant', content: 'For most apps, Zustand is simpler and sufficient. Redux is better for very large apps.' },
    ]

    const result = await llmCompact(messages, TEST_LLM_CONFIG)
    expect(result.length).toBeGreaterThan(0)
    expect(estimateMessageTokens(result)).toBeLessThan(estimateMessageTokens(messages) * 0.5)
  }, 30000)
})
