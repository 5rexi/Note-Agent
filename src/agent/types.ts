/**
 * Agent Core — 核心类型定义
 * 不依赖 Electron、React、Jotai。纯 TypeScript。
 */

// ── Message Types ──

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export type Message =
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoningContent?: string }
  | { role: 'tool'; toolCallId: string; toolName: string; result: unknown }
  | { role: 'system'; content: string }

// ── Permission System ──

export type PermissionMode = 'explore' | 'ask' | 'execute' | 'research'

export type PermissionResult =
  | { result: 'allow' }
  | { result: 'deny'; reason: string }
  | { result: 'ask'; description: string }

// ── Tool Result ──

export interface ToolResult<T = unknown> {
  data: T
  /** 是否需要在 UI 上弹出确认框（ASK 模式） */
  needsConfirmation?: boolean
  /** 给人类看的操作计划/描述 */
  plan?: string
  /** 操作预览（如 diff） */
  preview?: string
  /** 错误信息 */
  error?: string
  /** 结果是否因超出预算而被截断 */
  truncated?: boolean
  /** 完整结果保存的路径（truncated 为 true 时） */
  fullResultPath?: string
}

// ── Agent Events (向外广播，CLI / UI 消费) ──

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-use-start'; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool-use-end'; toolCallId: string; name: string; result: unknown }
  | { type: 'permission-request'; toolCallId: string; name: string; description: string; resolve: (allow: boolean) => void }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'model-switch'; provider: string; model: string; reason: string }
  | { type: 'context-compacted'; method: 'micro' | 'llm'; tokensBefore: number; tokensAfter: number }
  // Step-level progress events
  | { type: 'step-start'; stepId: number; description: string; totalSteps: number }
  | { type: 'step-end'; stepId: number; status: 'completed' | 'failed'; error?: string }
  | { type: 'step-retry'; stepId: number; attempt: number; reason: string }
  // Subagent event forwarding
  | { type: 'subagent-tool-start'; parentToolCallId: string; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'subagent-tool-end'; parentToolCallId: string; toolCallId: string; name: string; result: unknown }
  | { type: 'subagent-text'; parentToolCallId: string; text: string }
  // Todo progress
  | { type: 'todo-update'; tasks: Array<{ text: string; completed: boolean }>; completedCount: number; totalCount: number }

// ── LLM Config ──

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | string
  providerName?: string
  model: string
  apiKey: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
}

// ── Session / Context ──

export interface AgentContext {
  workspacePath: string
  mode: PermissionMode
  openFiles?: string[]
}

export interface RoundResult {
  messages: Message[]      // 本轮产生的新消息（assistant + tool）
  usage?: { inputTokens: number; outputTokens: number }
}
