/**
 * Shared types for the LLM client layer. The OpenAI and Anthropic
 * implementations both produce these events.
 */
import type { ToolCall } from '../types'

export interface LLMStreamEvent {
  type: 'text' | 'reasoning' | 'tool_use' | 'done' | 'error'
  text?: string
  reasoning?: string
  toolCall?: ToolCall
  error?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface LLMClient {
  stream(
    messages: import('../types').Message[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamEvent>
}

/** Total stream duration ceiling — guards against half-closed connections.
 *  Large tasks (e.g. long document generation) can legitimately take 30+ min.
 */
export const MAX_STREAM_DURATION_MS = 1_800_000

/** Per-request fetch timeout (initial response, not the full stream). */
export const REQUEST_TIMEOUT_MS = 60_000
