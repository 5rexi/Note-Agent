/**
 * SubagentTool — 子 Agent 模式
 *
 * 创建隔离的 AgentEngine 实例运行子任务，返回摘要报告。
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult, Message, LLMConfig, PermissionMode, AgentEvent } from '../../types'
import { AgentEngine } from '../../engine/AgentEngine'
import { getAllTools } from '../registry'

const inputSchema = z.object({
  task: z.string().describe('The sub-task description. Be specific about what needs to be done.'),
  model: z.string().optional().describe('Optional: override the model for this sub-agent'),
  mode: z.enum(['explore', 'ask', 'execute']).optional().describe('Optional: permission mode for sub-agent (default: inherits parent mode)'),
  maxRounds: z.number().int().positive().max(20).optional().describe('Optional: max rounds for sub-agent (default: 5)'),
  tools: z.array(z.string()).optional().describe('Optional: whitelist of tool names available to sub-agent'),
})

type Input = z.infer<typeof inputSchema>

// Default LLM config for sub-agent (will be overridden by parent's config).
// Intentionally empty so that missing initialization is caught early.
let parentLLMConfig: LLMConfig = {
  provider: '',
  model: '',
  apiKey: '',
}

export function setSubagentParentConfig(config: LLMConfig): void {
  parentLLMConfig = config
}

/**
 * Build the COMPACT report handed back to the parent. The whole point of a
 * subagent is to keep its noisy step-by-step work out of the parent context, so
 * we return only the subagent's final answer plus a one-line provenance note —
 * not a replay of every tool call.
 */
export function summarizeSubagentResult(messages: Message[]): string {
  const finalAnswer = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => (typeof (m as any).content === 'string' ? (m as any).content : ''))
    .filter((c) => c.trim())
    .pop() || ''

  const toolNames = [...new Set(
    messages.filter((m) => m.role === 'tool').map((m) => (m as any).toolName).filter(Boolean),
  )]
  const errorCount = messages.filter(
    (m) => m.role === 'tool' && (m as any).result && (m as any).result.error,
  ).length

  const lines: string[] = ['## Subagent Result']
  lines.push(finalAnswer ? finalAnswer.slice(0, 2000) : '(subagent produced no final summary)')
  if (toolNames.length > 0) {
    const errNote = errorCount > 0 ? `; ${errorCount} tool error(s)` : ''
    lines.push(`\n_Tools used: ${toolNames.join(', ')}${errNote}_`)
  }
  return lines.join('\n')
}

export const SubagentTool: Tool<Input, string> = {
  name: 'subagent',
  description: 'Delegate a sub-task to an isolated sub-agent that runs in its own context and returns ONLY a short summary. CRITICAL: the task description MUST be under 500 characters. Do NOT include file contents, code, or large text blocks — the subagent has its own tools and can read files independently. Use this for: large exploration, refactoring across modules, complex multi-step tasks. Also use it to debug a noisy/self-contained error (lots of logs, stack traces, or trial-and-error fixes) so that mess stays out of the main thread — but fix obvious errors (typos, missing imports) or errors tied to what you just did directly. For simple tasks, handle directly. Default mode inherits from parent session (e.g. execute mode allows write tools).',
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx): Promise<ToolResult<string>> {
    // Inherit parent mode by default so subagent permissions match the parent session.
    // Clamp subagent mode to be no more permissive than the parent session.
    const requestedMode = (input.mode ?? ctx.mode ?? 'explore') as PermissionMode
    const parentMode = ctx.mode ?? 'explore'
    const modeHierarchy: Record<PermissionMode, number> = { explore: 0, ask: 1, execute: 2, research: 2 }
    const mode: PermissionMode =
      modeHierarchy[requestedMode] > modeHierarchy[parentMode] ? parentMode : requestedMode
    const maxRounds = input.maxRounds ?? 8

    // Already cancelled before we even start.
    if (ctx.signal?.aborted) {
      return { data: '', error: 'Aborted by user' }
    }

    // Bound recursion: a subagent must not spawn deeper subagents indefinitely.
    const depth = (ctx.depth ?? 0) + 1
    const MAX_SUBAGENT_DEPTH = 1

    // Enforce task length limit at runtime (safety net when model ignores prompt rules)
    const MAX_TASK_LEN = 500
    let task = input.task.trim()
    if (task.length > MAX_TASK_LEN) {
      console.error(`[Subagent] WARNING: Task too long (${task.length} chars), truncating to ${MAX_TASK_LEN}`)
      // Extract file paths so subagent knows what to read
      const filePaths = [...task.matchAll(/(?:^|\s)([\w\-./]+\.(?:docx|pptx|md|txt|ts|js|json|yaml|yml|xml|csv))\b/gi)].map((m) => m[1])
      const uniquePaths = [...new Set(filePaths)]
      const pathHint = uniquePaths.length > 0
        ? `\n\n[SYSTEM: Key files referenced: ${uniquePaths.join(', ')}. Read these files directly.]`
        : ''
      task = task.slice(0, MAX_TASK_LEN) +
        `\n\n[SYSTEM: Task truncated from ${input.task.length} to ${MAX_TASK_LEN} chars. ` +
        `Read source files directly using readFile/grepSearch to get full content.` +
        pathHint
    }

    // Filter tools by whitelist. The gated install tools (installSkill/Mcp/Api)
    // are UI-create-context only and must NEVER be reachable via a subagent.
    const GATED_INSTALL_TOOLS = ['installSkill', 'installMcp', 'installApi']
    const allTools = getAllTools().filter((t) => !GATED_INSTALL_TOOLS.includes(t.name))
    let availableTools = input.tools && input.tools.length > 0
      ? allTools.filter((t) => input.tools!.includes(t.name) || input.tools!.some((a) => t.aliases?.includes(a)))
      : allTools

    // At max depth, deny further nesting by stripping the subagent tool.
    if (depth >= MAX_SUBAGENT_DEPTH) {
      availableTools = availableTools.filter((t) => t.name !== 'subagent')
    }

    if (availableTools.length === 0) {
      return { data: '', error: 'No tools available for sub-agent' }
    }

    // Use parent agent's LLM config if available, fallback to global parentLLMConfig
    const parentCfg = ctx.llmConfig || parentLLMConfig
    if (!parentCfg.apiKey) {
      return { data: '', error: 'Subagent failed: parent agent LLM config has no API key. Please check provider settings.' }
    }
    const llmConfig: LLMConfig = {
      ...parentCfg,
      model: input.model ?? parentCfg.model,
    }

    const engine = new AgentEngine({
      llmConfig,
      workspacePath: ctx.workspacePath,
      mode,
      tools: availableTools,
      maxRounds,
      shouldAvoidPermissionPrompts: true, // Background agents should not prompt user
      autoCompact: true,
      dataSources: ctx.dataSources, // share KB folders / APIs / MCP servers
      depth, // bound nested subagent recursion
    })

    // Propagate parent cancellation: aborting the turn aborts the subagent.
    const onAbort = () => engine.abort()
    ctx.signal?.addEventListener('abort', onAbort, { once: true })

    const parentId = ctx.parentToolCallId || 'unknown'
    const report = ctx.reportEvent

    try {
      console.error(`[Subagent] Starting task: ${task.slice(0, 80)}...`)
      let roundCount = 0
      for await (const event of engine.submit(task)) {
        // Forward live progress to the parent UI (does not enter parent context).
        if (event.type === 'text' && report) {
          report({ type: 'subagent-text', parentToolCallId: parentId, text: event.text })
        }
        if (event.type === 'tool-use-start') {
          roundCount++
          console.error(`[Subagent] Round ${roundCount}: tool=${event.name}`)
          if (report) {
            report({
              type: 'subagent-tool-start',
              parentToolCallId: parentId,
              toolCallId: event.toolCallId,
              name: event.name,
              input: event.input,
            })
          }
        }
        if (event.type === 'tool-use-end' && report) {
          report({
            type: 'subagent-tool-end',
            parentToolCallId: parentId,
            toolCallId: event.toolCallId,
            name: event.name,
            result: event.result,
          })
        }
        if (event.type === 'error') {
          console.error(`[Subagent] Error: ${event.message}`)
          return { data: '', error: `Sub-agent error: ${event.message}` }
        }
      }

      if (ctx.signal?.aborted) {
        return { data: '', error: 'Aborted by user' }
      }

      console.error(`[Subagent] Finished after ${roundCount} tool rounds`)
      return { data: summarizeSubagentResult(engine.getMessages()) }
    } catch (err: any) {
      console.error(`[Subagent] Failed: ${err.message}`)
      return { data: '', error: `Sub-agent failed: ${err.message}` }
    } finally {
      ctx.signal?.removeEventListener('abort', onAbort)
      // Roll the subagent's token usage up into the parent so cost reporting is
      // accurate. The parent's submit loop turns a 'usage' event into addUsage.
      if (report) {
        const records = engine.getCostTracker().getRecords()
        const inputTokens = records.reduce((s, r) => s + r.inputTokens, 0)
        const outputTokens = records.reduce((s, r) => s + r.outputTokens, 0)
        if (inputTokens || outputTokens) {
          report({ type: 'usage', inputTokens, outputTokens })
        }
      }
    }
  },

  renderToolUse(input) {
    const task = typeof input.task === 'string' ? input.task : ''
    return `Subagent: "${task.slice(0, 60)}..." (mode: ${input.mode ?? 'explore'})`
  },
}
