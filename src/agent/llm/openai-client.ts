/**
 * OpenAI-compatible streaming client (covers OpenAI, MiniMax, DeepSeek,
 * Moonshot, etc. — anything that speaks `/chat/completions` SSE).
 *
 * Notable behaviors:
 *  - Auto-expands `max_tokens` on token-limit retries.
 *  - Strips `<think>...</think>` blocks out of the text stream and re-emits
 *    them as `reasoning` events so the UI can show them in a folded panel.
 *  - Honors the model's native `delta.reasoning_content` (DeepSeek, Qwen).
 */
import type { LLMConfig, ContentPart } from '../types'
import { withRetry } from '../retry'
import { supportsVision, toOpenAIContent } from './format-conversion'
import {
  type LLMClient,
  type LLMStreamEvent,
  MAX_STREAM_DURATION_MS,
  REQUEST_TIMEOUT_MS,
} from './types'

export function createOpenAIClient(config: LLMConfig): LLMClient {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const url = `${baseUrl}/chat/completions`

  return {
    async *stream(messages, tools, signal) {
      const apiMessages = messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls) {
          const msg: any = {
            role: 'assistant',
            content: m.content,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          }
          // Many OpenAI-compatible providers (DeepSeek, Qwen, OpenRouter/Gemini)
          // require reasoning_content to be echoed back in multi-turn thinking
          // mode. OpenAI itself ignores unknown fields, so this is safe to send
          // unconditionally.
          if ((m as any).reasoningContent !== undefined) {
            msg.reasoning_content = (m as any).reasoningContent || ''
          }
          return msg
        }
        if (m.role === 'assistant') {
          const msg: any = {
            role: 'assistant',
            content: m.content,
          }
          // Echo reasoning_content back for any provider that needs it.
          if ((m as any).reasoningContent !== undefined) {
            msg.reasoning_content = (m as any).reasoningContent || ''
          }
          return msg
        }
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.toolCallId,
            content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
          }
        }
        if (m.role === 'user' && Array.isArray(m.content)) {
          const parts = supportsVision(config.model) ? m.content : m.content.filter((p) => p.type === 'text')
          if (parts.length === 0) return { role: 'user', content: '[图片]' }
          if (parts.every((p) => p.type === 'text')) {
            return { role: 'user', content: parts.map((p) => (p as any).text).join('\n') }
          }
          return { role: 'user', content: toOpenAIContent(parts as ContentPart[]) }
        }
        return { role: m.role, content: m.content }
      })

      const body: any = {
        model: config.model,
        messages: apiMessages,
        stream: true,
        max_tokens: config.maxTokens || 8192,
      }
      if (config.temperature != null) {
        body.temperature = config.temperature
      }
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
        body.tool_choice = 'auto'
        // DeepSeek does not support parallel tool calls — disable so the model
        // emits one tool call at a time, matching its training.
        if (baseUrl.includes('deepseek.com')) {
          body.parallel_tool_calls = false
        }
      }
      // DeepSeek V4 (pro/flash) requires thinking mode to produce output.
      // Without it the model returns empty deltas, causing apparent hangs.
      if (baseUrl.includes('deepseek.com') && config.model?.startsWith('deepseek-v4')) {
        body.thinking = { type: 'enabled' }
        body.reasoning_effort = 'high'
      }

      // Kimi (Moonshot) thinking models: enable thinking and preserved thinking for multi-turn tool use.
      // K2.6 supports thinking.keep="all" to preserve historical reasoning across turns.
      const isKimi = baseUrl.includes('moonshot') || baseUrl.includes('api.kimi.com')
      if (isKimi && (config.model?.includes('kimi-k2'))) {
        if (config.model?.includes('kimi-k2.6')) {
          body.thinking = { type: 'enabled', keep: 'all' }
        } else {
          body.thinking = { type: 'enabled' }
        }
        body.temperature = 1.0
      }

      // GLM (Zhipu) thinking models: enable preserved thinking for multi-turn reasoning continuity.
      const isGLM = baseUrl.includes('bigmodel') || baseUrl.includes('z.ai')
      if (isGLM && (config.model?.startsWith('glm-4.') || config.model?.startsWith('glm-5'))) {
        body.thinking = { type: 'enabled', clear_thinking: false }
      }

      console.log(`[OpenAIClient] Request: model=${config.model}, tools=${tools.length}, msgs=${apiMessages.length}`)
      // DeepSeek free tier frequently queues requests for minutes.
      // Use a shorter timeout so the user gets feedback instead of silent hangs.
      const isDeepSeek = baseUrl.includes('deepseek.com')
      const fetchTimeoutMs = isDeepSeek ? 25_000 : REQUEST_TIMEOUT_MS

      let currentMaxTokens = body.max_tokens
      const isKimiCode = baseUrl.includes('api.kimi.com')
      const res = await withRetry(
        async () => {
          const ctrl = new AbortController()
          const timeout = setTimeout(() => ctrl.abort(), fetchTimeoutMs)
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            }
            if (isKimiCode) {
              // Kimi Code API enforces a client whitelist; mimic the official Kimi CLI
              headers['User-Agent'] = 'KimiCLI/0.77'
            }
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
          } catch (err: any) {
            clearTimeout(timeout)
            // DeepSeek free tier queues can hang for minutes. Give a clear
            // message so the user knows it's an API-side queue, not a bug.
            if (isDeepSeek && err?.message?.includes('aborted')) {
              throw new Error(
                `DeepSeek API timed out after ${fetchTimeoutMs / 1000}s — the free tier is likely queueing requests. ` +
                `Try again in a moment, switch to a paid tier, or use a different provider.`,
              )
            }
            throw err
          }
        },
        {},
        (attempt, classified, delay) => {
          console.error(`[Retry] API call failed (${classified.category}), attempt ${attempt}/${3}, retrying in ${Math.round(delay)}ms...`)
          if (classified.category === 'token-limit' && currentMaxTokens < 32768) {
            currentMaxTokens = Math.min(currentMaxTokens * 2, 32768)
            body.max_tokens = currentMaxTokens
            console.error(`[Retry] Auto-expanded max_tokens to ${currentMaxTokens}`)
          }
        },
      )

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Accumulate tool call deltas
      const pendingTools: Record<string, { id?: string; name?: string; args: string }> = {}

      // <think>...</think> tag state machine
      let thinkState: 'none' | 'in-think' = 'none'
      let thinkBuffer = ''
      let textBuffer = ''

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

      function* flushPendingTools() {
        const seen = new Set<string>()
        for (const pt of Object.values(pendingTools)) {
          if (!pt.id || !pt.name) continue
          if (seen.has(pt.id)) {
            console.warn(`[OpenAIClient] Duplicate tool_call_id ${pt.id} detected, skipping duplicate`)
            continue
          }
          seen.add(pt.id)
          try {
            const input = JSON.parse(pt.args || '{}')
            yield { type: 'tool_use' as const, toolCall: { id: pt.id, name: pt.name, input } }
          } catch {
            yield { type: 'tool_use' as const, toolCall: { id: pt.id, name: pt.name, input: {} } }
          }
        }
        // Clear pending tools so they aren't emitted again at [DONE] or stream end.
        for (const key of Object.keys(pendingTools)) {
          delete pendingTools[key]
        }
      }

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
            if (thinkBuffer) {
              const trimmed = thinkBuffer.trim()
              if (trimmed) yield { type: 'reasoning', reasoning: trimmed }
              thinkBuffer = ''
            }
            if (textBuffer) {
              yield { type: 'text', text: textBuffer }
              textBuffer = ''
            }
            // Some providers (e.g. DeepSeek V4) may not send finish_reason
            // before [DONE] even when tool_calls were streamed.
            yield* flushPendingTools()
            yield { type: 'done' }
            continue
          }
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (!delta) continue

            // Defensive: delta.content may be null, undefined, or a non-string in some APIs.
            if (typeof delta.content === 'string' && delta.content) {
              let chunk = delta.content
              while (chunk.length > 0) {
                if (thinkState === 'none') {
                  const idx = chunk.indexOf('<think>')
                  if (idx === -1) {
                    textBuffer += chunk
                    chunk = ''
                  } else {
                    textBuffer += chunk.slice(0, idx)
                    if (textBuffer) {
                      yield { type: 'text', text: textBuffer }
                      textBuffer = ''
                    }
                    thinkState = 'in-think'
                    chunk = chunk.slice(idx + 7)
                  }
                } else {
                  const idx = chunk.indexOf('</think>')
                  if (idx === -1) {
                    thinkBuffer += chunk
                    chunk = ''
                  } else {
                    thinkBuffer += chunk.slice(0, idx)
                    if (thinkBuffer) {
                      const trimmed = thinkBuffer.trim()
                      if (trimmed) yield { type: 'reasoning', reasoning: trimmed }
                      thinkBuffer = ''
                    }
                    thinkState = 'none'
                    chunk = chunk.slice(idx + 8)
                  }
                }
              }
            }

            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
              yield { type: 'reasoning', reasoning: delta.reasoning_content }
            }

            if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                if (!tc || typeof tc !== 'object') continue
                const idx = tc.index ?? 0
                if (!pendingTools[idx]) pendingTools[idx] = { args: '' }
                if (tc.id) pendingTools[idx].id = tc.id
                if (tc.function?.name) pendingTools[idx].name = tc.function.name
                if (typeof tc.function?.arguments === 'string' && tc.function.arguments) {
                  pendingTools[idx].args += tc.function.arguments
                }
              }
            }

            if (parsed.usage) {
              yield {
                type: 'done',
                usage: {
                  inputTokens: parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0,
                  outputTokens: parsed.usage.completion_tokens || parsed.usage.output_tokens || 0,
                },
              }
              continue
            }

            const finish = parsed.choices?.[0]?.finish_reason
            // DeepSeek V4 may emit tool_call deltas but report finish_reason='stop'
            // instead of 'tool_calls'. Detect pending tools in either case.
            const hasPendingTools = Object.values(pendingTools).some((pt) => pt.id && pt.name)
            if (finish === 'tool_calls' || finish === 'function_call' || (finish === 'stop' && hasPendingTools)) {
              yield* flushPendingTools()
              yield { type: 'done' }
            } else if (finish === 'stop') {
              yield { type: 'done' }
            }
          } catch (parseErr: any) {
            // Log unexpected parse errors so we can diagnose provider-specific quirks.
            // Invalid JSON is common and harmless; other errors need investigation.
            if (parseErr?.message?.includes('JSON')) {
              // Skip invalid JSON lines silently
            } else {
              console.error(`[OpenAIClient] Stream chunk error: ${parseErr?.message}. Chunk: ${data.slice(0, 200)}`)
            }
          }
        }
      }

      if (thinkBuffer) {
        const trimmed = thinkBuffer.trim()
        if (trimmed) yield { type: 'reasoning', reasoning: trimmed }
      }
      if (textBuffer) {
        yield { type: 'text', text: textBuffer }
      }

      yield* flushPendingTools()

      const toolNames = Object.values(pendingTools).map((t) => t.name).filter(Boolean)
      console.log(`[OpenAIClient] Stream done: text=${textBuffer.length} chars, reasoning=${thinkBuffer.length} chars, tools=[${toolNames.join(', ')}]`)

      yield { type: 'done' }
      if (streamTimeout) clearTimeout(streamTimeout)
    },
  }
}

export type { LLMStreamEvent, LLMClient }
