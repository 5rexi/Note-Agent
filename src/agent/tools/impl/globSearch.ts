import { globSync } from 'glob'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  pattern: z.string().describe('Glob pattern to search for files'),
})

type Input = z.infer<typeof inputSchema>

export const GlobSearchTool: Tool<Input, string[]> = {
  name: 'globSearch',
  description: 'Search for files matching a glob pattern in the workspace.',
  inputSchema,
  aliases: ['glob'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<string[]>> {
    // Reject absolute patterns that would escape the workspace
    if (input.pattern.startsWith('/') || (process.platform === 'win32' && /^[A-Za-z]:/.test(input.pattern))) {
      return { data: [], error: 'Absolute patterns are not allowed' }
    }
    const matches = globSync(input.pattern, { cwd: ctx.workspacePath, nodir: true })
    return { data: matches }
  },

  renderToolUse(input) {
    return `Glob search: ${input.pattern}`
  },
}
