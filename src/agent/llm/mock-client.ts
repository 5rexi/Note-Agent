/**
 * Mock LLM Client — 用于集成测试
 * 不依赖真实 API，模拟 LLM 响应来测试 RoundExecutor / AgentEngine 流程
 */
import type { Message, ToolCall } from '../types'
import type { LLMClient, LLMStreamEvent } from './client'

export interface MockResponse {
  /** 延迟模拟（ms） */
  delayMs?: number
  /** 模拟的 SSE 事件序列 */
  events: LLMStreamEvent[]
}

export type MockHandler = (
  messages: Message[],
  toolSchemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
) => MockResponse

/**
 * 创建可编程的 Mock LLM Client
 */
export function createMockClient(handler: MockHandler): LLMClient {
  return {
    async *stream(messages, toolSchemas): AsyncGenerator<LLMStreamEvent, void, unknown> {
      const response = handler(messages, toolSchemas)

      if (response.delayMs && response.delayMs > 0) {
        await new Promise((r) => setTimeout(r, response.delayMs))
      }

      for (const event of response.events) {
        yield event
      }
    },
  }
}

// ── 常用响应工厂 ──

/** 返回纯文本响应 */
export function textResponse(text: string, delayMs?: number): MockResponse {
  return {
    delayMs,
    events: [
      { type: 'text', text },
      { type: 'done' },
    ],
  }
}

/** 返回 tool_use 响应 */
export function toolUseResponse(toolCall: ToolCall, delayMs?: number): MockResponse {
  return {
    delayMs,
    events: [
      { type: 'tool_use', toolCall },
      { type: 'done' },
    ],
  }
}

/** 返回错误响应 */
export function errorResponse(error: string, delayMs?: number): MockResponse {
  return {
    delayMs,
    events: [
      { type: 'error', error },
      { type: 'done' },
    ],
  }
}

/** 返回文本 + tool_use 组合 */
export function mixedResponse(text: string, toolCall: ToolCall, delayMs?: number): MockResponse {
  return {
    delayMs,
    events: [
      { type: 'text', text },
      { type: 'tool_use', toolCall },
      { type: 'done' },
    ],
  }
}
