/**
 * DoneTool — explicit termination signal for the agent.
 *
 * When the model has fully completed the task and has nothing more to do,
 * it calls this tool. The RoundExecutor detects the call and breaks the
 * loop, preventing the model from wandering off into unrelated reads.
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  summary: z.string().optional().describe('Optional final summary of what was accomplished'),
})

type Input = z.infer<typeof inputSchema>

export const DoneTool: Tool<Input, { done: true }> = {
  name: 'done',
  description:
    'Call this tool when you have FULLY completed the task and have no further actions to take. ' +
    'After calling this tool, the session ends and no more tools will be executed. ' +
    'Do NOT call this tool if the task is incomplete or if you still need to call other tools. ' +
    'Output your final answer or summary in the assistant message BEFORE calling this tool.',
  inputSchema,
  aliases: ['terminate', 'finish'],

  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isDestructive() {
    return false
  },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, _ctx): Promise<ToolResult<{ done: true }>> {
    return {
      data: { done: true },
      preview: input.summary ? `Task complete: ${input.summary.slice(0, 80)}` : 'Task complete',
    }
  },

  renderToolUse(input) {
    return input.summary ? `Done: ${input.summary.slice(0, 60)}` : 'Done'
  },
}
