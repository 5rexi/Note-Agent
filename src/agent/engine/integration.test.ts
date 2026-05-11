/**
 * AgentEngine + RoundExecutor 集成测试（Mock LLM）
 *
 * 验证完整对话流程：
 * - 纯文本对话
 * - Tool 调用 + 结果返回
 * - 权限请求（ASK 模式）
 * - 多轮对话
 * - 错误处理
 */
import { describe, it, expect } from 'bun:test'
import { AgentEngine } from './AgentEngine'
import { createMockClient, textResponse, toolUseResponse, errorResponse, mixedResponse } from '../llm/mock-client'
import { ReadFileTool } from '../tools/impl/readFile'
import { WriteFileTool } from '../tools/impl/writeFile'
import type { LLMConfig } from '../types'

const TEST_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'test-key',
}

describe('AgentEngine integration (mock)', () => {
  it('should complete a simple text conversation', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [],
      llmClient: createMockClient(() => textResponse('Hello! How can I help?')),
    })

    const events: Array<{ type: string; text?: string }> = []
    for await (const event of engine.submit('Say hello')) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'text')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)

    const textEvent = events.find((e) => e.type === 'text')
    expect(textEvent?.text).toBe('Hello! How can I help?')
  })

  it('should execute a tool call and return result', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      llmClient: createMockClient((_msgs, schemas) => {
        // First call: model requests tool
        if (_msgs.length <= 2) {
          return toolUseResponse({
            id: 'call-1',
            name: 'readFile',
            input: { path: 'package.json' },
          })
        }
        // Second call: model responds after seeing tool result
        return textResponse('I see you have a React project.')
      }),
    })

    const events: Array<{ type: string; text?: string; name?: string; result?: unknown }> = []
    for await (const event of engine.submit('What frameworks do I use?')) {
      events.push(event)
    }

    const toolStart = events.find((e) => e.type === 'tool-use-start')
    expect(toolStart).toBeDefined()
    expect(toolStart?.name).toBe('readFile')

    const toolEnd = events.find((e) => e.type === 'tool-use-end')
    expect(toolEnd).toBeDefined()

    const finalText = events.find((e) => e.type === 'text' && e.text?.includes('React'))
    expect(finalText).toBeDefined()

    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('should handle permission request in ASK mode', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'ask',
      tools: [WriteFileTool],
      llmClient: createMockClient(() =>
        toolUseResponse({
          id: 'call-1',
          name: 'writeFile',
          input: { path: 'test.txt', content: 'hello' },
        }),
      ),
    })

    const events: Array<any> = []
    let permissionResolved = false

    for await (const event of engine.submit('Write a file')) {
      events.push(event)
      if (event.type === 'permission-request') {
        expect(event.description).toBeDefined()
        event.resolve(true) // Allow
        permissionResolved = true
      }
    }

    expect(permissionResolved).toBe(true)
    expect(events.some((e) => e.type === 'tool-use-start')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('should deny permission and continue', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'ask',
      tools: [WriteFileTool],
      llmClient: createMockClient(() =>
        toolUseResponse({
          id: 'call-1',
          name: 'writeFile',
          input: { path: 'test.txt', content: 'hello' },
        }),
      ),
    })

    let denied = false
    for await (const event of engine.submit('Write a file')) {
      if (event.type === 'permission-request') {
        event.resolve(false) // Deny
        denied = true
      }
    }

    expect(denied).toBe(true)
    // Engine should still finish
    expect(engine.isRunning()).toBe(false)
  })

  it('should handle LLM errors gracefully', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [],
      llmClient: createMockClient(() => errorResponse('Connection timeout')),
    })

    const events: Array<any> = []
    for await (const event of engine.submit('Trigger error')) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'error')).toBe(true)
    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent?.message).toContain('timeout')
  })

  it('should prevent concurrent submit calls', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [],
      llmClient: createMockClient(() => textResponse('ok', 50)),
    })

    // Start first submit and consume a bit to ensure running is set
    const gen1 = engine.submit('First')
    const firstEvent = await gen1.next()
    expect(firstEvent.value?.type).toBe('text')

    // Second submit should be rejected
    const gen2 = engine.submit('Second')
    const events2: any[] = []
    for await (const e of gen2) events2.push(e)

    expect(events2.some((e) => e.type === 'error')).toBe(true)

    // Finish first
    for await (const _ of gen1) {}
  })

  it('should accumulate messages across rounds', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [],
      llmClient: createMockClient(() => textResponse('Response')),
    })

    for await (const _ of engine.submit('Message 1')) {}
    const msgsAfter1 = engine.getMessages().length

    for await (const _ of engine.submit('Message 2')) {}
    const msgsAfter2 = engine.getMessages().length

    expect(msgsAfter2).toBeGreaterThan(msgsAfter1)
  })

  it('should handle mixed text + tool_use response', async () => {
    const engine = new AgentEngine({
      llmConfig: TEST_LLM_CONFIG,
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      llmClient: createMockClient(() =>
        mixedResponse('Let me check...', {
          id: 'call-1',
          name: 'readFile',
          input: { path: 'README.md' },
        }),
      ),
    })

    const events: any[] = []
    for await (const event of engine.submit('Check README')) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'text' && e.text === 'Let me check...')).toBe(true)
    expect(events.some((e) => e.type === 'tool-use-start')).toBe(true)
  })
})
