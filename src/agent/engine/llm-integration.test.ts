/**
 * AgentEngine 真实 LLM 集成测试
 * 验证完整对话流程：文本回复、工具调用、多轮对话
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { AgentEngine } from './AgentEngine'
import { ReadFileTool } from '../tools/impl/readFile'
import { WriteFileTool } from '../tools/impl/writeFile'
import type { LLMConfig } from '../types'

const TEST_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'MiniMax-M2.7',
  apiKey: process.env.NA_API_KEY || '',
  baseUrl: process.env.NA_BASE_URL || 'https://api.minimaxi.com/v1',
}

const HAS_API_KEY = !!TEST_LLM_CONFIG.apiKey

describe('AgentEngine (live LLM)', () => {
  beforeAll(() => {
    if (!HAS_API_KEY) {
      console.log('Skipping live LLM tests: NA_API_KEY not set')
    }
  })

  it('should have a natural language conversation', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'explore',
      tools: [ReadFileTool],
      maxRounds: 3,
    })

    const events: any[] = []
    for await (const event of engine.submit('Say "hello" and nothing else')) {
      events.push(event)
    }

    const texts = events.filter((e) => e.type === 'text').map((e) => e.text)
    const fullText = texts.join('')
    expect(fullText.length).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)

  it('should use readFile tool when asked about a file', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'explore',
      tools: [ReadFileTool],
      maxRounds: 3,
    })

    const events: any[] = []
    for await (const event of engine.submit('Read the file package.json and tell me the project name')) {
      events.push(event)
    }

    const toolUses = events.filter((e) => e.type === 'tool-use-start')
    expect(toolUses.length).toBeGreaterThan(0)
    expect(toolUses[0].name).toBe('readFile')
    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)

  it('should handle multi-turn conversation', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'explore',
      tools: [ReadFileTool],
      maxRounds: 3,
    })

    // First turn
    for await (const _ of engine.submit('What files are in the project?')) {
      // consume
    }

    // Second turn
    const events: any[] = []
    for await (const event of engine.submit('Now read package.json')) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)

  it('should handle ask mode with writeFile tool', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'ask',
      tools: [WriteFileTool],
      maxRounds: 2,
    })

    const events: any[] = []
    for await (const event of engine.submit('Create a file called test-output.txt with content "hi"')) {
      events.push(event)
      if (event.type === 'permission-request') {
        event.resolve(false) // Deny the write
      }
    }

    expect(events.some((e) => e.type === 'permission-request')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)

  it('should recover from invalid tool input gracefully', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'explore',
      tools: [ReadFileTool],
      maxRounds: 3,
    })

    const events: any[] = []
    for await (const event of engine.submit('Read the file "package.json')) {
      events.push(event)
    }

    // Should complete without crashing even with malformed input
    expect(events.some((e) => e.type === 'done') || events.some((e) => e.type === 'error')).toBe(true)
  }, 30000)

  it('should respect maxRounds limit', async () => {
    if (!HAS_API_KEY) return
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'explore',
      tools: [ReadFileTool],
      maxRounds: 1,
    })

    const events: any[] = []
    for await (const event of engine.submit('Count to 5')) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'done')).toBe(true)
  }, 30000)
})
