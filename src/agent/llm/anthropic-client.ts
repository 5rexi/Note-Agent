/**
 * Anthropic Messages API streaming client.
 *
 * Anthropic's wire format differs from OpenAI's: tool_use blocks come back
 * as content_block_start events, system messages are top-level (not part
 * of the message array), and thinking is delivered via thinking_delta.
 */
import type { LLMConfig, ContentPart } from '../types'
import { withRetry } from '../retry'
import { CACHE_BREAKPOINT } from '../prompt/minimal'
import { supportsVision, toAnthropicContent } from './format-conversion'
import {
  type LLMClient,
  type LLMStreamEvent,
  MAX_STREAM_DURATION_MS,
  REQUEST_TIMEOUT_MS,
} from './types'

export function createAnthropicClient(config: LLMConfig): LLMClient {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
  const url = `${baseUrl}/v1/messages`

  return {
    async *stream(messages, tools, signal, options) {
      const apiMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.role === 'assistant' && m.toolCalls) {
            const content: any[] = []
            // Anthropic extended-thinking models require prior thinking blocks
            // to be passed back verbatim in the content array.
            if ((m as any).reasoningContent) {
              content.push({ type: 'thinking', thinking: (m as any).reasoningContent })
            }
            content.push({ type: 'text', text: m.content })
            content.push(...m.toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })))
            return { role: 'assistant', content }
          }
          if (m.role === 'assistant') {
            const content: any[] = []
            if ((m as any).reasoningContent) {
              content.push({ type: 'thinking', thinking: (m as any).reasoningContent })
            }
            content.push({ type: 'text', text: m.content })
            return { role: 'assistant', content }
          }
          if (m.role === 'tool') {
            return {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
              }],
            }
          }
          if (m.role === 'user' && Array.isArray(m.content)) {
            const parts = supportsVision(config.model) ? m.content : m.content.filter((p) => p.type === 'text')
            if (parts.length === 0) return { role: 'user', content: '[图片]' }
            if (parts.every((p) => p.type === 'text')) {
              return { role: 'user', content: parts.map((p) => (p as any).text).join('\n') }
            }
            return { role: 'user', content: toAnthropicContent(parts as ContentPart[]) }
          }
          return { role: m.role, content: m.content }
        })

      const systemMsg = messages.find((m) => m.role === 'system')

      const body: any = {
        model: config.model,
        messages: apiMessages,
        max_tokens: config.maxTokens || 8192,
        stream: true,
      }
      if (config.temperature != null) {
        body.temperature = config.temperature
      }
      // Prompt caching: split the system prompt on the cache breakpoint and
      // mark the stable prefix as ephemeral-cacheable so it (plus the tool
      // schemas) is reused across rounds instead of re-billed each turn.
      if (systemMsg) {
        const [stable, ...rest] = String(systemMsg.content).split(CACHE_BREAKPOINT)
        const volatile = rest.join(CACHE_BREAKPOINT)
        const systemBlocks: any[] = [
          { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
        ]
        if (volatile.trim()) {
          systemBlocks.push({ type: 'text', text: volatile })
        }
        body.system = systemBlocks
      }
      if (tools.length > 0) {
        body.tools = tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
          // Cache the (stable) tool schemas by marking the final tool.
          ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        }))
        // 'any' forces the model to use one of the provided tools (empty-round
        // recovery); otherwise let it decide.
        if (options?.toolChoice === 'required') {
          body.tool_choice = { type: 'any' }
        }
      }

      const res = await withRetry(
        async () => {
          const ctrl = new AbortController()
          const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          }
          // Provider-specific headers can be added here if needed
          const r = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
          })
          clearTimeout(timeout)
          if (!r.ok) {
            const errText = await r.text()
            const err = new Error(`API error ${r.status}: ${errText}`)
            ;(err as any).status = r.status
            throw err
          }
          return r
        },
        {},
        (attempt, classified, delay) => {
          console.error(`[Retry] API call failed (${classified.category}), attempt ${attempt}/${3}, retrying in ${Math.round(delay)}ms...`)
        },
      )

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let streamTimeout: ReturnType<typeof setTimeout> | null = null
      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout)
          streamTimeout = null
        }
      }
      streamTimeout = setTimeout(() => {
        console.error(`[LLM] Stream timeout after ${MAX_STREAM_DURATION_MS}ms total, aborting`)
        reader.cancel('Stream timeout').catch(() => {})
      }, MAX_STREAM_DURATION_MS)

      // Accumulate input_json_delta for tool_use blocks across stream chunks.
      let pendingTool: { id: string; name: string; inputJson: string } | null = null
      let usage: { inputTokens: number; outputTokens: number } | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          clearStreamTimeout()
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') {
            yield { type: 'done' }
            continue
          }
          try {
            const parsed = JSON.parse(data)
            const type = parsed.type

            if (type === 'content_block_delta') {
              const delta = parsed.delta
              if (delta.type === 'text_delta') {
                yield { type: 'text', text: delta.text }
              }
              if (delta.type === 'thinking_delta') {
                yield { type: 'reasoning', reasoning: delta.thinking }
              }
              if (delta.type === 'input_json_delta') {
                if (pendingTool) {
                  pendingTool.inputJson += delta.partial_json || ''
                }
              }
            }

            if (type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              pendingTool = {
                id: parsed.content_block.id,
                name: parsed.content_block.name,
                inputJson: '',
              }
              // Some simple tools may have a fully populated input object at start.
              if (parsed.content_block.input && typeof parsed.content_block.input === 'object') {
                pendingTool.inputJson = JSON.stringify(parsed.content_block.input)
              }
            }

            if (type === 'content_block_stop') {
              if (pendingTool) {
                let input: any = {}
                try {
                  if (pendingTool.inputJson.trim()) {
                    input = JSON.parse(pendingTool.inputJson)
                  }
                } catch {
                  console.warn(`[AnthropicClient] Failed to parse tool input JSON for ${pendingTool.name}, falling back to {}`)
                }
                yield {
                  type: 'tool_use',
                  toolCall: {
                    id: pendingTool.id,
                    name: pendingTool.name,
                    input,
                  },
                }
                pendingTool = null
              }
            }

            if (type === 'message_delta') {
              if (parsed.usage) {
                usage = {
                  inputTokens: parsed.usage.input_tokens || 0,
                  outputTokens: parsed.usage.output_tokens || 0,
                }
              }
            }

            if (type === 'message_stop') {
              yield { type: 'done', usage }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Flush any pending tool if the stream ended without content_block_stop.
      if (pendingTool) {
        let input: any = {}
        try {
          if (pendingTool.inputJson.trim()) {
            input = JSON.parse(pendingTool.inputJson)
          }
        } catch {
          console.warn(`[AnthropicClient] Failed to parse tool input JSON for ${pendingTool.name} at stream end, falling back to {}`)
        }
        yield {
          type: 'tool_use',
          toolCall: {
            id: pendingTool.id,
            name: pendingTool.name,
            input,
          },
        }
        pendingTool = null
      }

      yield { type: 'done', usage }
      if (streamTimeout) clearStreamTimeout()
    },
  }
}

export type { LLMStreamEvent, LLMClient }
