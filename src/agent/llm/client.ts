/**
 * LLM client facade.
 *
 * Provider-specific implementations live in their own modules. This file
 * is the factory + the public type re-exports that callers import.
 */
import type { LLMConfig } from '../types'
import { createAnthropicClient } from './anthropic-client'
import { createOpenAIClient } from './openai-client'

export { createAnthropicClient } from './anthropic-client'
export { createOpenAIClient } from './openai-client'
export type { LLMClient, LLMStreamEvent } from './types'
export { supportsVision, toOpenAIContent, toAnthropicContent } from './format-conversion'

export function createLLMClient(config: LLMConfig) {
  if (config.provider === 'anthropic') {
    return createAnthropicClient(config)
  }
  // Default: OpenAI-compatible (covers OpenAI, MiniMax, DeepSeek, Moonshot, etc.)
  return createOpenAIClient(config)
}
