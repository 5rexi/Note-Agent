/**
 * Round executor — orchestrates one LLM call + tool dispatch per round.
 *
 * Lower-level concerns live in their own modules:
 *   - tool-executor.ts        runs tool calls, applies permissions/budget
 *   - context-compactor.ts    auto-compacts message history each round
 *   - schema-conversion.ts    converts Zod schemas to JSON Schema
 *
 * This file owns the round loop, empty-round recovery, and event streaming.
 */
import type { Message, AgentEvent, LLMConfig, ToolCall } from '../types'
import type { Tool, ToolContext } from '../tools/Tool'
import type { LLMClient, LLMStreamEvent } from '../llm/client'
import { createLLMClient } from '../llm/client'
import type { PermissionContext } from '../tools/permissions'
import { type CompactConfig, estimateMessageTokens, microcompact } from '../compact'
import { runTools } from './tool-executor'
import { maybeCompactMessages } from './context-compactor'
import { zodToJsonSchema } from './schema-conversion'
import { CACHE_BREAKPOINT } from '../prompt/minimal'
import { logger } from '../logger'

export interface RoundExecutorOptions {
  /** 固定配置，或每轮动态选择 */
  llmConfig: LLMConfig | ((round: number, messages: Message[]) => LLMConfig)
  tools: Tool[]
  toolContext: ToolContext
  permissionContext: PermissionContext
  systemPrompt: string | ((round: number, messages: Message[]) => string)
  maxRounds?: number
  /** 可选：注入自定义 LLMClient（用于测试） */
  llmClient?: LLMClient
  /** 可选：AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 可选：启用自动上下文压缩（默认 true） */
  autoCompact?: boolean
  /** 可选：压缩配置 */
  compactConfig?: Partial<CompactConfig>
}

/**
 * 执行一轮对话（可能包含多个 tool-use 循环）。
 * 直接修改 messages 数组（追加 assistant + tool 消息）。
 * 通过 generator 向外广播事件。
 */
export async function* executeRound(
  messages: Message[],
  opts: RoundExecutorOptions,
): AsyncGenerator<AgentEvent, void, unknown> {
  const resolveConfig = (round: number): LLMConfig => {
    if (typeof opts.llmConfig === 'function') {
      return opts.llmConfig(round, messages)
    }
    return opts.llmConfig
  }

  const maxRounds = opts.maxRounds ?? 20
  const autoCompact = opts.autoCompact !== false

  // Build tool schemas for API
  const toolSchemas = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema ? zodToJsonSchema(t.inputSchema) : { type: 'object', properties: {} },
  }))

  let lastConfigKey = ''
  let client: LLMClient | undefined = opts.llmClient

  let endedByDone = false
  let endedByAskQuestion = false
  let consecutiveEmptyRounds = 0
  // Set after an empty (text-only) round so the next round forces a tool call.
  // Far more reliable than nagging in the prompt, and works across providers.
  let forceToolChoiceNextRound = false

  for (let round = 0; round < maxRounds; round++) {
    // Stop promptly if the user cancelled (don't start another round).
    if (opts.signal?.aborted) {
      logger.info('[RoundExecutor] Aborted — stopping round loop.')
      return
    }

    // Auto-compact before each round if context is too long
    const compactEvent = await maybeCompactMessages(messages, resolveConfig(0), {
      autoCompact,
      compactConfig: opts.compactConfig,
      signal: opts.signal,
    })
    if (compactEvent) {
      yield compactEvent
    }

    // Resolve config for this round (supports dynamic routing)
    const roundConfig = resolveConfig(round)
    const configKey = `${roundConfig.provider}:${roundConfig.model}`

    // Create new client if config changed (and no injected client)
    if (!opts.llmClient && configKey !== lastConfigKey) {
      client = createLLMClient(roundConfig)
      lastConfigKey = configKey
    }

    // Check if context is getting large and suggest subagent decomposition
    const msgTokens = estimateMessageTokens(messages)
    const contextWarning = msgTokens > 40000 && round > 1
      ? `\n\n[SYSTEM NOTICE] Context has grown to ~${msgTokens} tokens. If the remaining work involves exploring many files or complex multi-step operations, consider using the **subagent** tool to delegate sub-tasks with isolated context.`
      : ''

    // Build messages with system prompt (support dynamic builder)
    const baseSystemPrompt = typeof opts.systemPrompt === 'function'
      ? opts.systemPrompt(round, messages)
      : opts.systemPrompt

    // Merge any trailing system messages into the main system prompt.
    // Some APIs (e.g., MiniMax) reject multiple system messages.
    const trailingSystem = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')

    // Keep the cache breakpoint between the stable prefix and the volatile
    // suffix. Everything appended per-round (context warning, trailing
    // reminders) MUST land after the breakpoint so the cached prefix stays
    // byte-identical across rounds. If the builder didn't emit a breakpoint
    // (e.g. no plan/todo), insert one so the prefix is still cacheable.
    const [stablePrefix, ...volatileRest] = baseSystemPrompt.split(CACHE_BREAKPOINT)
    const volatileSuffix = [
      volatileRest.join(CACHE_BREAKPOINT),
      contextWarning.trim(),
      trailingSystem,
    ].filter(Boolean).join('\n\n')
    const mergedSystemPrompt = volatileSuffix
      ? stablePrefix + CACHE_BREAKPOINT + volatileSuffix
      : stablePrefix

    // Filter out system messages from the messages array to avoid duplicates
    const nonSystemMessages = messages.filter((m) => m.role !== 'system')

    const apiMessages: Message[] = [
      { role: 'system', content: mergedSystemPrompt },
      ...nonSystemMessages,
    ]

    // Safety check: ensure we don't exceed the model's context window.
    const inputTokens = estimateMessageTokens(apiMessages)
    const outputBudget = roundConfig.maxTokens || 8192
    const contextWindow = roundConfig.contextWindow || 128_000
    if (inputTokens + outputBudget > contextWindow * 0.95) {
      logger.warn(`[RoundExecutor] Context window safety check failed: ${inputTokens} input + ${outputBudget} output > ${Math.floor(contextWindow * 0.95)} threshold (window: ${contextWindow}). Triggering emergency compaction.`)
      // Try aggressive micro-compaction with fewer kept rounds as a last resort.
      const emergencyCompacted = microcompact(apiMessages, 2)
      const compactedTokens = estimateMessageTokens(emergencyCompacted)
      if (compactedTokens + outputBudget <= contextWindow * 0.95) {
        apiMessages.length = 0
        apiMessages.push(...emergencyCompacted)
        logger.info(`[RoundExecutor] Emergency compaction succeeded: ${inputTokens} -> ${compactedTokens} tokens`)
      } else {
        yield {
          type: 'error',
          message: `Context too large for this model (${contextWindow} tokens). Even after compaction, estimated ${compactedTokens} input + ${outputBudget} output tokens exceed the safe limit. Please start a new session or use a model with a larger context window.`,
        }
        return
      }
    }

    // Call LLM
    if (!client) {
      yield { type: 'error', message: 'LLM client not available' }
      return
    }
    const toolChoice = forceToolChoiceNextRound ? 'required' : 'auto'
    forceToolChoiceNextRound = false
    logger.info(`[RoundExecutor] Round ${round}: calling LLM with ${apiMessages.length} messages, ${toolSchemas.length} tools, tool_choice=${toolChoice}`)
    const stream = client.stream(apiMessages, toolSchemas, opts.signal, { toolChoice })
    let roundText = ''
    let roundReasoning = ''
    const roundToolCalls: ToolCall[] = []

    let roundUsage: { inputTokens: number; outputTokens: number } | undefined

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            if (event.text) {
              roundText += event.text
              yield { type: 'text', text: event.text }
            }
            break
          case 'reasoning':
            if (event.reasoning) {
              roundReasoning += event.reasoning
              yield { type: 'reasoning', text: event.reasoning }
            }
            break
          case 'tool_use':
            if (event.toolCall) {
              roundToolCalls.push(event.toolCall)
              yield {
                type: 'tool-use-start',
                toolCallId: event.toolCall.id,
                name: event.toolCall.name,
                input: event.toolCall.input,
              }
            }
            break
          case 'error':
            yield { type: 'error', message: event.error || 'Unknown LLM error' }
            return
          case 'done':
            if (event.usage) {
              roundUsage = event.usage
            }
            break
        }
      }
    } catch (streamErr: any) {
      logger.error(`[RoundExecutor] Stream iteration error in round ${round}:`, streamErr?.message, streamErr?.stack)
      yield { type: 'error', message: streamErr?.message || 'Stream iteration failed' }
      return
    }

    // Save assistant message
    logger.info(`[RoundExecutor] Round ${round} result: text=${roundText.length} chars, toolCalls=${roundToolCalls.length} [${roundToolCalls.map(t => t.name).join(', ')}]`)
    const assistantMsg: Message = {
      role: 'assistant',
      content: roundText,
      toolCalls: roundToolCalls.length > 0 ? roundToolCalls : undefined,
      reasoningContent: roundReasoning || undefined,
    }
    messages.push(assistantMsg)

    // Yield usage for this round
    if (roundUsage) {
      yield { type: 'usage', inputTokens: roundUsage.inputTokens, outputTokens: roundUsage.outputTokens }
    }

    // 3-tier empty-round recovery
    if (roundToolCalls.length === 0) {
      logger.info(`[RoundExecutor] Round ${round}: EMPTY round detected (no tool calls).`)
      consecutiveEmptyRounds++

      // The system prompt allows text-only responses AFTER receiving tool results.
      // If the model outputs text without tool calls immediately after tool results,
      // give it ONE grace round (keep the message, no harsh reminder). This prevents
      // cutting off a task that is still in progress (e.g. the model read a file and
      // needs one more round to decide the next tool call).
      const priorNonSystem = [...messages].slice(0, -1).reverse().find((m) => m.role !== 'system')
      const isReplyingToTools = priorNonSystem?.role === 'tool'
      if (isReplyingToTools && consecutiveEmptyRounds === 1) {
        logger.info(`[RoundExecutor] Round ${round}: Grace round after tool results — keeping message, forcing a tool next round.`)
        // Force a tool call next round. Since `done` is itself a tool, the model
        // can satisfy this by finishing (call `done`) OR by making progress —
        // both are valid outcomes, and neither is a text-only stall.
        messages.push({ role: 'system', content: 'Reminder: If you have completed the user\'s request, call `done`. Otherwise call the next tool. Do NOT repeat actions that already succeeded.' })
        forceToolChoiceNextRound = true
        continue
      }

      // Past the grace round (or not replying to tools) — treat as a true empty round.
      // Check if the model produced meaningful text BEFORE popping the assistant message.
      const currentAssistant = messages[messages.length - 1]
      const assistantHasMeaningfulText =
        currentAssistant?.role === 'assistant' &&
        (currentAssistant.content || '').trim().length > 20

      messages.pop()

      if (consecutiveEmptyRounds >= 2) {
        // If the model produced meaningful text in the current assistant message,
        // treat it as a completion rather than a stall. The model may have
        // finished its work and is providing a final summary / answer.
        if (assistantHasMeaningfulText) {
          logger.info(`[RoundExecutor] Round ${round}: Model produced text-only response — treating as completion.`)
          // Restore the popped assistant message so the caller can persist it
          messages.push(currentAssistant)
          break
        }

        logger.info(`[RoundExecutor] Round ${round}: Task stalled after ${consecutiveEmptyRounds} empty rounds. Breaking.`)
        yield { type: 'error', message: `Task stalled — model produced no tool calls for ${consecutiveEmptyRounds} consecutive rounds. The task cannot continue.` }
        break
      }

      // Force a tool call next round and add a short reminder to steer which one.
      // Forcing is the actual lever; the reminder only helps the model pick well.
      logger.info(`[RoundExecutor] Round ${round}: Empty round — forcing tool choice next round (${consecutiveEmptyRounds} empty).`)
      messages.push({
        role: 'system',
        content: 'You must call a tool now. If the task is finished, call `done`; otherwise call the tool that makes progress.',
      })
      forceToolChoiceNextRound = true

      continue
    } else {
      // Non-empty round: reset counter
      consecutiveEmptyRounds = 0
    }

    // Execute tools (with subagent event forwarding)
    const subagentEvents: AgentEvent[] = []
    const toolResults = await runTools(
      roundToolCalls,
      opts.tools,
      opts.toolContext,
      opts.permissionContext,
      (event) => { subagentEvents.push(event) },
      roundConfig,
    )

    // If the user cancelled while a tool was running, stop now without
    // feeding results back into another LLM round.
    if (opts.signal?.aborted) {
      logger.info('[RoundExecutor] Aborted during tool execution — stopping.')
      return
    }

    // Yield any subagent events that were collected during execution
    for (const evt of subagentEvents) {
      yield evt
    }

    // Check if askUserQuestion was called — if so, save tool results and STOP.
    // The conversation will resume after the user answers via the next user message.
    const hasAskQuestion = toolResults.some((tr) => tr.toolName === 'askUserQuestion')

    logger.info(`[RoundExecutor] Tool results: ${toolResults.length} tools executed`)

    // Detect redundant tool calls in recent history to prevent infinite loops.
    const duplicateWarnings: string[] = []
    for (const tr of toolResults) {
      const originalCall = roundToolCalls.find((tc) => tc.id === tr.toolCallId)
      if (originalCall && isDuplicateToolCall(originalCall, messages)) {
        const warning = `WARNING: You already called '${tr.toolName}' with the same arguments recently and received a result. Calling it again is redundant and wastes tokens. If the previous result was unclear, try a different approach.`
        duplicateWarnings.push(warning)
        logger.info(`[RoundExecutor] Duplicate tool call detected: ${tr.toolName}`)
      }
    }

    for (const tr of toolResults) {
      const resultSummary = typeof tr.result === 'string' ? tr.result.slice(0, 100) : JSON.stringify(tr.result).slice(0, 100)
      logger.info(`[RoundExecutor]   - ${tr.toolName}: ${resultSummary}${resultSummary.length >= 100 ? '...' : ''}`)
      // Find the tool to potentially render a human-readable result for the LLM
      const tool = opts.tools.find((t) => t.name === tr.toolName || t.aliases?.includes(tr.toolName))
      let llmResult: unknown = tr.result
      if (tool?.renderToolResult) {
        try {
          llmResult = tool.renderToolResult(tr.result as any)
        } catch {
          llmResult = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
        }
      } else if (typeof tr.result !== 'string') {
        llmResult = JSON.stringify(tr.result)
      }

      const toolMsg: Message = {
        role: 'tool',
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        result: llmResult,
      }
      messages.push(toolMsg)

      yield {
        type: 'tool-use-end',
        toolCallId: tr.toolCallId,
        name: tr.toolName,
        result: tr.result,
      }
    }

    // Inject duplicate warnings as a system message so the LLM sees them before the next round.
    if (duplicateWarnings.length > 0) {
      messages.push({
        role: 'system',
        content: duplicateWarnings.join('\n'),
      })
    }

    if (hasAskQuestion) {
      endedByAskQuestion = true
      break
    }

    // If the model explicitly signaled completion via the `done` tool, end the
    // loop immediately so it doesn't wander off into unrelated reads.
    const doneResult = toolResults.find((tr) => tr.toolName === 'done')
    if (doneResult) {
      logger.info(`[RoundExecutor] done/terminate tool called — ending session.`)
      endedByDone = true
      // If the assistant message has no text content, inject the done summary
      // so the UI shows a meaningful final message instead of an empty one.
      // Note: tool results have already been appended, so the last message is a
      // tool message — we must search backwards for the most recent assistant.
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
      if (lastAssistant && (!lastAssistant.content || lastAssistant.content.trim().length === 0)) {
        const donePreview = typeof doneResult.result === 'string'
          ? doneResult.result
          : (doneResult.result as any)?.summary || 'Task complete'
        lastAssistant.content = donePreview
        logger.info(`[RoundExecutor] Injected done summary into empty assistant message.`)
      }
      break
    }
  }

  // Loop exited because round === maxRounds (every iteration ran the LLM but
  // the model never produced a final assistant message that ended the task).
  // Surface this so the UI doesn't silently freeze and the user knows to
  // continue with a new message or raise the maxRounds setting.
  if (!endedByDone && !endedByAskQuestion) {
    const lastMessage = messages[messages.length - 1]
    const exhaustedWithoutFinal = lastMessage?.role === 'tool'
      || (lastMessage?.role === 'assistant' && (lastMessage.toolCalls?.length ?? 0) > 0)
    if (exhaustedWithoutFinal) {
      logger.info(`[RoundExecutor] Hit maxRounds=${maxRounds} without final assistant turn.`)
      yield {
        type: 'error',
        message: `Agent reached the round limit (${maxRounds}) before finishing the task. Send a new message to continue, or raise the limit in settings (agentMaxRounds).`,
      }
    }
  }
}

/** Check whether a tool call with the same name + arguments was recently executed. */
function isDuplicateToolCall(toolCall: ToolCall, messages: Message[]): boolean {
  // Look back through recent assistant messages and their tool calls.
  // Only check the last 10 rounds to avoid false positives from distant history.
  let roundsChecked = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      roundsChecked++
      if (roundsChecked > 10) break
      for (const tc of msg.toolCalls || []) {
        if (tc.name === toolCall.name && JSON.stringify(tc.input) === JSON.stringify(toolCall.input)) {
          return true
        }
      }
    }
  }
  return false
}

