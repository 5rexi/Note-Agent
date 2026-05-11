import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'

const inputSchema = z.object({
  path: z.string().optional().describe('Relative path to list. Defaults to workspace root.'),
})

type Input = z.infer<typeof inputSchema>

export const ListFilesTool: Tool<Input, string> = {
  name: 'listFiles',
  description: 'List files and directories in a given path within the workspace.',
  inputSchema,
  aliases: ['ls'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    const dirPath = safePath(input.path || '.', ctx.workspacePath)
    if (!existsSync(dirPath)) {
      return { data: '', error: `Directory not found: ${input.path || '.'}` }
    }
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const lines = entries.map((e) => {
      const prefix = e.isDirectory() ? '[D]' : '[F]'
      return `${prefix} ${e.name}`
    })
    return { data: lines.join('\n') }
  },

  renderToolUse(input) {
    return `List files: ${input.path || '.'}`
  },
}
