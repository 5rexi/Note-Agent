/**
 * Context compaction for the round executor.
 *
 * Each round, before sending to the LLM, we check whether the message
 * history has grown past the compact threshold. If so, `compactMessages`
 * either runs a fast micro-compaction (drop redundant tool results) or a
 * proper LLM-driven summarization, and we replace the message array
 * in-place so callers see the compacted version.
 */
import type { LLMConfig, Message } from '../types'
import { compactMessages, type CompactConfig } from '../compact'

export interface CompactedEvent {
  type: 'context-compacted'
  method: 'micro' | 'llm'
  tokensBefore: number
  tokensAfter: number
}

/**
 * Mutates `messages` in place if compaction triggers. Returns an event
 * describing the compaction (so the caller can yield it to the UI), or
 * null if nothing happened.
 */
export async function maybeCompactMessages(
  messages: Message[],
  config: LLMConfig,
  options: {
    autoCompact: boolean
    compactConfig?: Partial<CompactConfig>
    signal?: AbortSignal
  },
): Promise<CompactedEvent | null> {
  if (!options.autoCompact) return null

  const result = await compactMessages(messages, config, options.compactConfig, options.signal)
  if (!result.wasCompacted) return null

  // Replace messages array contents in-place.
  messages.length = 0
  messages.push(...result.messages)

  return {
    type: 'context-compacted',
    method: result.method === 'micro' ? 'micro' : 'llm',
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
  }
}
