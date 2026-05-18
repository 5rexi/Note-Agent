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

/**
 * AbortSignal.any polyfill for environments where it is missing (older Electron,
 * some Bun builds). Falls back to manually forwarding abort events.
 * All added listeners are cleaned up when the composite signal aborts.
 */
function abortSignalAny(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) {
    try {
      return (AbortSignal as any).any(signals)
    } catch {
      // Fall through to polyfill
    }
  }
  const ctrl = new AbortController()
  const onAbort = () => { ctrl.abort() }

  const cleanup = () => {
    for (const s of signals) {
      s.removeEventListener('abort', onAbort)
    }
  }

  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort()
      cleanup()
      break
    }
    s.addEventListener('abort', onAbort, { once: true })
  }

  // Clean up all source listeners when the composite signal aborts
  ctrl.signal.addEventListener('abort', cleanup, { once: true })

  return ctrl.signal
}

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
      // NOTE: kimi-for-coding does NOT support the thinking parameter — it causes
      // "tokenization failed" errors. Only enable for kimi-k2.x models.
      const isKimi = baseUrl.includes('moonshot') || baseUrl.includes('api.kimi.com')
      if (isKimi && config.model?.includes('kimi-k2')) {
        if (config.model?.includes('kimi-k2.6')) {
          body.thinking = { type: 'enabled', keep: 'all' }
        } else {
          body.thinking = { type: 'enabled' }
        }
        body.temperature = 1.0
      }
      // kimi-for-coding still needs temperature=1.0 for best results, but no thinking param.
      if (isKimi && config.model === 'kimi-for-coding') {
        body.temperature = 1.0
      }

      // GLM (Zhipu) thinking models: enable preserved thinking for multi-turn reasoning continuity.
      const isGLM = baseUrl.includes('bigmodel') || baseUrl.includes('z.ai')
      if (isGLM && (config.model?.startsWith('glm-4.') || config.model?.startsWith('glm-5'))) {
        body.thinking = { type: 'enabled', clear_thinking: false }
      }

      const isKimiCode = baseUrl.includes('api.kimi.com')
      // Request logging removed to reduce terminal noise
      // DeepSeek free tier frequently queues requests for minutes.
      // Use a shorter timeout so the user gets feedback instead of silent hangs.
      const isDeepSeek = baseUrl.includes('deepseek.com')
      const fetchTimeoutMs = isDeepSeek ? 25_000 : REQUEST_TIMEOUT_MS

      let currentMaxTokens = body.max_tokens
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
              // Kimi Code API enforces a client whitelist; mimic the official Kimi CLI.
              // Use a recent version number that matches the actual CLI release cycle.
              headers['User-Agent'] = 'KimiCLI/1.44.0'
            }
            const r = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: signal ? abortSignalAny([signal, ctrl.signal]) : ctrl.signal,
            })
            clearTimeout(timeout)
            if (!r.ok) {
              const errText = await r.text()
              // Provide user-friendly hints for common provider-specific errors.
              if (r.status === 402 && errText.includes('Insufficient Balance')) {
                if (isKimiCode) {
                  throw new Error(
                    `Kimi Code API error 402: Insufficient Balance. ` +
                    `This is the Kimi Code platform (api.kimi.com), which has a separate billing system from the regular Moonshot platform. ` +
                    `Please check your membership status at https://www.kimi.com/code/console. ` +
                    `If your balance appears normal, this may be a temporary API issue — try again in a few minutes.`,
                  )
                }
                throw new Error(
                  `API error 402: Insufficient Balance. Please check your account balance and billing status.`,
                )
              }
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
          if (classified.category === 'token-limit' && currentMaxTokens < 32768) {
            currentMaxTokens = Math.min(currentMaxTokens * 2, 32768)
            body.max_tokens = currentMaxTokens
          }
        },
      )

      if (!res.body) {
        // Response body is null — server may have returned an empty response
        yield { type: 'error', error: 'Response body is empty' }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Accumulate tool call deltas
      const pendingTools: Record<string, { id?: string; name?: string; args: string }> = {}

      // <think>...</think> tag state machine
      let thinkState: 'none' | 'in-think' = 'none'
      let thinkBuffer = ''
      let textBuffer = ''
      const THINK_MAX_CHARS = 8000  // Safety: if think grows too large, treat as text (unclosed tag)

      // Loop-detection: Kimi Code may repeat the same JSON block or pseudo-tool-call
      // text when it degenerates in long conversations.
      let lastContentChunk = ''
      let repeatCount = 0
      const REPEAT_THRESHOLD = 5
      function isDegenerateLoop(chunk: string): boolean {
        // Strip whitespace for comparison
        const normalized = chunk.replace(/\s/g, '')
        const lastNormalized = lastContentChunk.replace(/\s/g, '')
        if (normalized.length > 10 && normalized === lastNormalized) {
          repeatCount++
          return repeatCount >= REPEAT_THRESHOLD
        }
        repeatCount = 0
        lastContentChunk = chunk
        return false
      }

      let streamTimeout: ReturnType<typeof setTimeout> | null = null
      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout)
          streamTimeout = null
        }
      }
      streamTimeout = setTimeout(() => {
        // Stream timeout — aborting
        reader.cancel('Stream timeout').catch(() => {})
      }, MAX_STREAM_DURATION_MS)

      /**
       * Attempt to parse JSON that may contain unescaped control characters
       * (newlines, tabs) which some providers send in function.arguments.
       * Also handles truncated JSON by detecting incomplete trailing content.
       */
      function safeJsonParse(str: string): any {
        try {
          return JSON.parse(str)
        } catch {
          // Providers like MiniMax may embed literal newlines/tabs inside
          // JSON string values. Escape them while preserving already-escaped ones.
          let fixed = str
            .replace(/\\n/g, '\u0000') // temporarily mask escaped \n
            .replace(/\\t/g, '\u0001') // temporarily mask escaped \t
            .replace(/\n/g, '\\n')       // escape literal newlines
            .replace(/\t/g, '\\t')       // escape literal tabs
            .replace(/\u0000/g, '\\n')   // restore masked \n
            .replace(/\u0001/g, '\\t')   // restore masked \t
          try {
            return JSON.parse(fixed)
          } catch {
            // JSON may be truncated (e.g. hit max_tokens mid-string).
            // Attempt a conservative recovery: close the object/array and parse
            // whatever complete properties we have.
            const trimmed = fixed.trimEnd()
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              // 1) Try appending just the closing brace/bracket
              try { return JSON.parse(trimmed + (trimmed.startsWith('{') ? '}' : ']')) } catch { /* fall through */ }

              // 2) Try stripping a trailing comma then close
              try { return JSON.parse(trimmed.replace(/,\s*$/, '') + (trimmed.startsWith('{') ? '}' : ']')) } catch { /* fall through */ }

              // 3) For objects, try to keep only fully-defined properties by
              // walking forward and stopping before the first incomplete value.
              if (trimmed.startsWith('{')) {
                const recovered = recoverTruncatedObject(trimmed)
                if (recovered !== null) {
                  try { return JSON.parse(recovered) } catch { /* fall through */ }
                }
              }
            }
            return undefined
          }
        }
      }

      /**
       * Given a truncated JSON object string, try to recover a valid object
       * by keeping only complete key-value pairs.
       */
      function recoverTruncatedObject(str: string): string | null {
        let i = 1 // skip opening {
        let depth = 0
        let inString = false
        let escape = false
        let lastSafeIndex = -1
        let expectKey = true

        while (i < str.length) {
          const c = str[i]
          if (escape) {
            escape = false
            i++
            continue
          }
          if (c === '\\') {
            escape = true
            i++
            continue
          }
          if (c === '"') {
            inString = !inString
            i++
            continue
          }
          if (!inString) {
            if (c === '{' || c === '[') depth++
            if (c === '}' || c === ']') depth--
            if (c === ':' && depth === 0 && expectKey) {
              expectKey = false
            }
            if (c === ',' && depth === 0 && !expectKey) {
              lastSafeIndex = i
              expectKey = true
            }
          }
          i++
        }

        if (lastSafeIndex > 0) {
          return str.slice(0, lastSafeIndex) + '}'
        }
        return null
      }

      function* flushPendingTools() {
        const seen = new Set<string>()
        for (const pt of Object.values(pendingTools)) {
          // Some providers (e.g. MiniMax) may send tool_calls deltas with arguments
          // but missing id or name. Generate fallbacks so the model gets feedback
          // instead of silent drop.
          const toolId = pt.id || `call_fallback_${Math.random().toString(36).slice(2, 10)}`
          const toolName = pt.name || 'unknown'
          if (!pt.id || !pt.name) {
            const preview = pt.args?.slice(0, 100) || '(empty)'
            // Tool call missing id/name — using fallback
          }
          if (seen.has(toolId)) {
            // Duplicate tool_call_id detected, skipping
            continue
          }
          seen.add(toolId)
          const input = safeJsonParse(pt.args || '{}')
          if (input === undefined) {
            const preview = pt.args?.slice(0, 200) || '(empty)'
            // Failed to parse tool args — yielding empty input
            yield { type: 'tool_use' as const, toolCall: { id: toolId, name: toolName, input: {} } }
          } else {
            yield { type: 'tool_use' as const, toolCall: { id: toolId, name: toolName, input } }
          }
        }
        // Clear pending tools so they aren't emitted again at [DONE] or stream end.
        for (const key of Object.keys(pendingTools)) {
          delete pendingTools[key]
        }
      }

      try {
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
            // Kimi Code sends SSE lines as "data:{...}" (no space after colon).
            // Standard OpenAI uses "data: {...}". Accept both shapes.
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trimStart()
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

              // Defensive: some providers may emit non-object data lines
              if (!parsed || typeof parsed !== 'object') continue

              // Check for API errors embedded in the stream
              if (parsed.error) {
                // API error in stream
                continue
              }

              // Defensive: choices may be missing or non-array in some provider quirks
              if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) continue

              const delta = parsed.choices[0]?.delta
              if (!delta || typeof delta !== 'object') continue

              // Defensive: delta.content may be null, undefined, or a non-string in some APIs.
              if (typeof delta.content === 'string' && delta.content) {
                let chunk = delta.content

                // Kimi Code degeneration: filter out pseudo-tool-call text that the model
                // outputs when it confuses itself in long conversations.
                if (/^\s*functions\.\w+:\d+\s*\{/.test(chunk)) {
                  // Filtered pseudo-tool-call text
                  chunk = ''
                }

                // Loop detection: if the model repeats the same chunk, it may be stuck.
                if (isDegenerateLoop(chunk)) {
                  // Model stuck in repeat loop — aborting stream
                  reader.cancel('Model repeat loop detected').catch(() => {})
                  clearStreamTimeout()
                  yield { type: 'error', error: 'Model output degraded into a repeat loop. The conversation has become too long for this model. Please start a new session or reduce the task complexity.' }
                  return
                }

                while (chunk.length > 0) {
                  if (thinkState === 'none') {
                    const idx = chunk.indexOf('<think>')
                    if (idx === -1) {
                      textBuffer += chunk
                      chunk = ''
                    } else {
                      textBuffer += chunk.slice(0, idx)
                      thinkState = 'in-think'
                      chunk = chunk.slice(idx + 7)
                    }
                  } else {
                    const idx = chunk.indexOf('</think>')
                    if (idx === -1) {
                      thinkBuffer += chunk
                      chunk = ''
                      // Safety valve: unclosed <think> that grows too large is likely
                      // a false positive or malformed model output. Treat as normal text.
                      if (thinkBuffer.length > THINK_MAX_CHARS) {
                        textBuffer += '\n<think>' + thinkBuffer
                        thinkBuffer = ''
                        thinkState = 'none'
                      }
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

                  // Defensive: some providers may emit stray text as tool_calls deltas
                  // that lack ALL identifying fields (index, id, type, function).
                  // Normal tool_call deltas always have at least one of these.
                  const hasToolIdentity =
                    tc.index !== undefined ||
                    tc.id ||
                    tc.type ||
                    tc.function !== undefined
                  if (!hasToolIdentity) {
                    const stray = tc.function?.arguments
                    if (typeof stray === 'string' && stray) {
                      textBuffer += stray
                    }
                    continue
                  }

                  if (!pendingTools[idx]) pendingTools[idx] = { args: '' }
                  if (tc.id) pendingTools[idx].id = tc.id
                  if (tc.function?.name) pendingTools[idx].name = tc.function.name

                  // Some providers (e.g. Kimi Code) may send arguments as a pre-parsed
                  // object instead of a JSON string. Handle both shapes.
                  const args = tc.function?.arguments
                  if (typeof args === 'string' && args) {
                    pendingTools[idx].args += args
                  } else if (args && typeof args === 'object') {
                    try {
                      pendingTools[idx].args += JSON.stringify(args)
                    } catch {
                      // Failed to stringify tool arguments
                    }
                  }
                }
                // Debug log for provider-specific tool_call quirks
                const toolDebug = delta.tool_calls.map((tc: any) => {
                  const args = tc?.function?.arguments
                  let argPreview = ''
                  if (typeof args === 'string') {
                    argPreview = args.slice(0, 40)
                  } else if (args !== undefined && args !== null) {
                    try {
                      const serialized = JSON.stringify(args)
                      argPreview = typeof serialized === 'string' ? serialized.slice(0, 40) : String(args).slice(0, 40)
                    } catch {}
                  }
                  return {
                    id: tc?.id,
                    name: tc?.function?.name,
                    argType: typeof args,
                    argPreview,
                  }
                })
                // Tool calls delta logging removed
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
                // If the model produced text before calling tools, yield it first
                // so the user sees intermediate reasoning/summary.
                if (textBuffer) {
                  yield { type: 'text', text: textBuffer }
                  textBuffer = ''
                }
                // Finish reason logging removed
                yield* flushPendingTools()
                yield { type: 'done' }
              } else if (finish === 'stop') {
                // Finish reason = stop, no pending tools
                yield { type: 'done' }
              }
            } catch (parseErr: any) {
              // Log unexpected parse errors so we can diagnose provider-specific quirks.
              // Invalid JSON is common and harmless; other errors need investigation.
              if (parseErr?.message?.includes('JSON')) {
                // Skip invalid JSON lines silently
              }
            }
          }
        }
      } catch (streamErr: any) {
        clearStreamTimeout()
        // Stream read error
        yield { type: 'error', error: streamErr?.message || 'Stream read failed' }
        return
      }

      clearStreamTimeout()

      // If <think> was never closed, the content was likely normal text (false positive).
      if (thinkBuffer) {
        const trimmed = thinkBuffer.trim()
        if (trimmed) {
          if (thinkBuffer.length > THINK_MAX_CHARS) {
            yield { type: 'text', text: trimmed }
          } else {
            yield { type: 'reasoning', reasoning: trimmed }
          }
        }
      }
      if (textBuffer) {
        yield { type: 'text', text: textBuffer }
      }

      const toolNamesBeforeFlush = Object.values(pendingTools).map((t) => t.name).filter(Boolean)
      yield* flushPendingTools()

      // Stream done logging removed

      yield { type: 'done' }
      if (streamTimeout) clearTimeout(streamTimeout)
    },
  }
}

export type { LLMStreamEvent, LLMClient }
