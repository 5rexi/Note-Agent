/**
 * Auto-compact — 上下文窗口压缩
 *
 * 策略（由轻到重）：
 * 1. Microcompact：清理旧 tool result，替换为占位符
 * 2. LLM Compact：用轻量模型生成对话摘要，保留最近 N 轮
 */

import type { Message, LLMConfig } from './types'
import { createLLMClient } from './llm/client'

export interface CompactConfig {
  /** 触发压缩的 token 阈值（默认 80000 ≈ 128K 窗口的 60%，留足输出余量） */
  threshold: number
  /** 压缩后保留的最近完整轮数（默认 5） */
  keepRecentRounds: number
  /** Microcompact 后仍超限，是否启用 LLM Compact（默认 true） */
  enableLLMCompact: boolean
  /** LLM Compact 使用的模型配置（默认使用当前模型） */
  compactModel?: LLMConfig
}

const DEFAULT_COMPACT_CONFIG: CompactConfig = {
  threshold: 80_000,
  keepRecentRounds: 5,
  enableLLMCompact: true,
}

/** 粗略估算 token 数：1 token ≈ 4 chars（英文）或 1.5 chars（中文） */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // Simple heuristic: count characters, divide by 3.5 for mixed CJK/Latin
  let latin = 0
  let cjk = 0
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch) || /\p{Script=Hiragana}/u.test(ch) || /\p{Script=Katakana}/u.test(ch)) {
      cjk++
    } else {
      latin++
    }
  }
  return Math.ceil(latin / 4 + cjk / 1.5)
}

/** 估算消息数组的总 token 数 */
export function estimateMessageTokens(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      total += estimateTokens(content)
    } else if (msg.role === 'assistant') {
      total += estimateTokens(msg.content)
      if (msg.reasoningContent) {
        total += estimateTokens(msg.reasoningContent)
      }
      if (msg.toolCalls) {
        total += estimateTokens(JSON.stringify(msg.toolCalls))
      }
    } else if (msg.role === 'tool') {
      total += estimateTokens(JSON.stringify(msg.result))
    } else if (msg.role === 'system') {
      total += estimateTokens(msg.content)
    }
  }
  return total
}

/** 判断是否需要进行压缩 */
export function shouldCompact(messages: Message[], threshold: number = DEFAULT_COMPACT_CONFIG.threshold): boolean {
  return estimateMessageTokens(messages) > threshold
}

/** 将消息按 "轮" 分组（user → assistant → tools → user → ...） */
export function groupIntoRounds(messages: Message[]): Message[][] {
  const rounds: Message[][] = []
  let currentRound: Message[] = []

  for (const msg of messages) {
    if (msg.role === 'user' && currentRound.length > 0) {
      rounds.push(currentRound)
      currentRound = [msg]
    } else {
      currentRound.push(msg)
    }
  }

  if (currentRound.length > 0) {
    rounds.push(currentRound)
  }

  return rounds
}

// ── Microcompact ──

/**
 * Microcompact：将旧的 tool result 替换为占位符
 * 保留最近 keepRecent 轮的完整内容
 */
export function microcompact(messages: Message[], keepRecentRounds: number = DEFAULT_COMPACT_CONFIG.keepRecentRounds): Message[] {
  const rounds = groupIntoRounds(messages)
  const totalRounds = rounds.length

  const result: Message[] = []

  for (let i = 0; i < totalRounds; i++) {
    const round = rounds[i]
    const isRecent = i >= totalRounds - keepRecentRounds

    for (const msg of round) {
      if (msg.role === 'tool' && !isRecent) {
        // Replace tool result with placeholder
        const resultStr = msg.result !== undefined ? JSON.stringify(msg.result) : 'undefined'
        result.push({
          ...msg,
          result: `[Compacted: ${msg.toolName} → ${resultStr.length} chars]`,
        })
      } else if (msg.role === 'assistant' && !isRecent) {
        // Strip reasoning content from old assistant messages — it accumulates
        // rapidly and is not needed for future rounds
        if (msg.reasoningContent) {
          result.push({
            ...msg,
            reasoningContent: `[Compacted: ${msg.reasoningContent.length} chars of reasoning]`,
          })
        } else {
          result.push(msg)
        }
      } else {
        result.push(msg)
      }
    }
  }

  return result
}

// ── LLM Compact ──

const COMPACT_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the following conversation history.

Rules:
1. Preserve all key decisions, facts, and code changes
2. Preserve user instructions and preferences
3. Summarize tool results briefly (just the outcomes, not full output)
4. Keep the summary under 2000 tokens
5. Use bullet points for clarity
6. Do NOT include pleasantries or meta-commentary

Format:
## Conversation Summary
[Overview of what happened]

## Key Decisions
- [decision 1]
- [decision 2]

## Code Changes
- [file/path: what changed]

## User Preferences
- [preference 1]`

/**
 * LLM Compact：用轻量模型生成摘要，替换旧消息
 * 保留最近 keepRecent 轮的完整对话
 */
export async function llmCompact(
  messages: Message[],
  llmConfig: LLMConfig,
  keepRecentRounds: number = DEFAULT_COMPACT_CONFIG.keepRecentRounds,
  signal?: AbortSignal,
): Promise<Message[]> {
  const rounds = groupIntoRounds(messages)
  const totalRounds = rounds.length

  if (totalRounds <= keepRecentRounds) {
    return messages
  }

  const oldRounds = rounds.slice(0, totalRounds - keepRecentRounds)
  const recentRounds = rounds.slice(totalRounds - keepRecentRounds)

  // Build conversation text for old rounds (exclude reasoning content)
  const oldConversation = oldRounds
    .flat()
    .map((m) => {
      if (m.role === 'user') {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `User: ${content}`
      } else if (m.role === 'assistant') {
        // Only include actual content + tool calls, never reasoning
        let text = m.content || ''
        if (m.toolCalls && m.toolCalls.length > 0) {
          text += ` [tool_calls: ${m.toolCalls.map(tc => tc.name).join(', ')}]`
        }
        return `Assistant: ${text}`
      } else if (m.role === 'tool') {
        return `Tool(${m.toolName}): ${JSON.stringify(m.result)}`
      } else {
        return `System: ${m.content}`
      }
    })
    .join('\n\n')

  const client = createLLMClient(llmConfig)

  const summaryMessages: Message[] = [
    { role: 'system', content: COMPACT_PROMPT },
    { role: 'user', content: oldConversation },
  ]

  let summary = ''
  const stream = client.stream(summaryMessages, [], signal)
  for await (const event of stream) {
    if (event.type === 'text') {
      summary += event.text
    }
  }

  // Replace old rounds with a single system message containing the summary
  const summaryMessage: Message = {
    role: 'system',
    content: `## Previous Conversation Summary\n\n${summary}`,
  }

  return [summaryMessage, ...recentRounds.flat()]
}

// ── Main Entry ──

export interface CompactResult {
  messages: Message[]
  wasCompacted: boolean
  method: 'none' | 'micro' | 'llm'
  tokensBefore: number
  tokensAfter: number
}

/**
 * 主入口：检查并执行压缩
 */
export async function compactMessages(
  messages: Message[],
  llmConfig?: LLMConfig,
  config: Partial<CompactConfig> = {},
  signal?: AbortSignal,
): Promise<CompactResult> {
  const cfg = { ...DEFAULT_COMPACT_CONFIG, ...config }
  const tokensBefore = estimateMessageTokens(messages)

  if (tokensBefore <= cfg.threshold) {
    return { messages, wasCompacted: false, method: 'none', tokensBefore, tokensAfter: tokensBefore }
  }

  // Step 1: Microcompact
  let result = microcompact(messages, cfg.keepRecentRounds)
  let tokensAfter = estimateMessageTokens(result)

  if (tokensAfter <= cfg.threshold) {
    return { messages: result, wasCompacted: true, method: 'micro', tokensBefore, tokensAfter }
  }

  // Step 2: LLM Compact (if enabled and config provided)
  if (cfg.enableLLMCompact && llmConfig) {
    try {
      result = await llmCompact(result, llmConfig, cfg.keepRecentRounds, signal)
      tokensAfter = estimateMessageTokens(result)
      return { messages: result, wasCompacted: true, method: 'llm', tokensBefore, tokensAfter }
    } catch (err) {
      // If LLM compact fails, fall back to microcompact result
      console.error('[Compact] LLM compact failed:', err)
    }
  }

  return { messages: result, wasCompacted: true, method: 'micro', tokensBefore, tokensAfter }
}
