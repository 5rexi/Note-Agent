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

export function summarizeSubagentResult(messages: Message[]): string {
  const lines: string[] = ['## Subagent Result\n']

  // Collect all messages in chronological order with role labels
  const history: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content = typeof (m as any).content === 'string' ? (m as any).content : JSON.stringify((m as any).content)
      history.push(`User: ${content.slice(0, 300)}`)
    } else if (m.role === 'assistant') {
      const content = typeof (m as any).content === 'string' ? (m as any).content : ''
      if (content.trim()) {
        history.push(`Assistant: ${content.slice(0, 500)}`)
      }
    } else if (m.role === 'tool') {
      const toolName = (m as any).toolName || 'unknown'
      const result = (m as any).result
      if (result?.error) {
        history.push(`Tool(${toolName}) ERROR: ${result.error.slice(0, 300)}`)
      } else if (result?.data) {
        const dataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
        history.push(`Tool(${toolName}): ${dataStr.slice(0, 400)}`)
      } else {
        history.push(`Tool(${toolName}): ${JSON.stringify(result).slice(0, 300)}`)
      }
    }
  }

  // Include full chronological history (truncated per entry above)
  if (history.length > 0) {
    lines.push('**Execution History:**')
    for (const entry of history) {
      lines.push(`- ${entry}`)
    }
  }

  // Extract final assistant answer (last assistant message with content)
  const assistantMsgs = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => (typeof (m as any).content === 'string' ? (m as any).content : ''))
    .filter((c) => c.trim())
  if (assistantMsgs.length > 0) {
    const final = assistantMsgs[assistantMsgs.length - 1]
    lines.push(`\n**Final Answer:**\n${final.slice(0, 2000)}`)
  }

  // List tools used
  const toolNames = messages
    .filter((m) => m.role === 'tool')
    .map((m) => (m as any).toolName)
    .filter(Boolean)
  const uniqueTools = [...new Set(toolNames)]
  if (uniqueTools.length > 0) {
    lines.push(`\n**Tools Used:** ${uniqueTools.join(', ')}`)
  }

  lines.push(`\n**Total Messages:** ${messages.length}`)

  return lines.join('\n')
}

export const SubagentTool: Tool<Input, string> = {
  name: 'subagent',
  description: 'Delegate a sub-task to an isolated sub-agent. CRITICAL: the task description MUST be under 500 characters. Do NOT include file contents, code, or large text blocks — the subagent has its own tools and can read files independently. Use this for: large exploration, refactoring across modules, complex multi-step tasks. For simple tasks, handle directly. Default mode inherits from parent session (e.g. execute mode allows write tools).',
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
    // Inherit parent mode by default so subagent permissions match the parent session
    const mode = (input.mode ?? ctx.mode ?? 'explore') as PermissionMode
    const maxRounds = input.maxRounds ?? 5

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

    // Filter tools by whitelist
    const allTools = getAllTools()
    const availableTools = input.tools && input.tools.length > 0
      ? allTools.filter((t) => input.tools!.includes(t.name) || input.tools!.some((a) => t.aliases?.includes(a)))
      : allTools

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
    })

    const subMessages: Message[] = []

    const parentId = ctx.parentToolCallId || 'unknown'
    const report = ctx.reportEvent

    try {
      console.error(`[Subagent] Starting task: ${task.slice(0, 80)}...`)
      let roundCount = 0
      for await (const event of engine.submit(task)) {
        if (event.type === 'text') {
          subMessages.push({ role: 'assistant', content: event.text })
          if (report) {
            report({ type: 'subagent-text', parentToolCallId: parentId, text: event.text })
          }
        }
        if (event.type === 'reasoning') {
          subMessages.push({ role: 'assistant', content: event.text })
        }
        if (event.type === 'tool-use-start') {
          roundCount++
          console.error(`[Subagent] Round ${roundCount}: tool=${event.name}`)
          subMessages.push({
            role: 'assistant',
            content: `Tool: ${event.name}`,
            toolCalls: [{ id: event.toolCallId, name: event.name, input: event.input }],
          })
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
        if (event.type === 'tool-use-end') {
          const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
          console.error(`[Subagent] Tool result: ${resultStr.slice(0, 120)}`)
          subMessages.push({
            role: 'tool',
            toolCallId: event.toolCallId,
            toolName: event.name,
            result: event.result,
          })
          if (report) {
            report({
              type: 'subagent-tool-end',
              parentToolCallId: parentId,
              toolCallId: event.toolCallId,
              name: event.name,
              result: event.result,
            })
          }
        }
        if (event.type === 'error') {
          console.error(`[Subagent] Error: ${event.message}`)
          return { data: '', error: `Sub-agent error: ${event.message}` }
        }
        if (event.type === 'done') {
          console.error(`[Subagent] Round completed`)
        }
      }

      console.error(`[Subagent] Finished after ${roundCount} tool rounds`)
      const summary = summarizeSubagentResult(engine.getMessages())
      return { data: summary }
    } catch (err: any) {
      console.error(`[Subagent] Failed: ${err.message}`)
      return { data: '', error: `Sub-agent failed: ${err.message}` }
    }
  },

  renderToolUse(input) {
    return `Subagent: "${input.task.slice(0, 60)}..." (mode: ${input.mode ?? 'explore'})`
  },
}
