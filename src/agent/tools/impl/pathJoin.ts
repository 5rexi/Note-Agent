import { z } from 'zod'
import { join } from 'path'
import type { Tool } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  segments: z.array(z.string()).describe('Path segments to join (e.g., [".note_agent", "skills", "my-skill"])'),
})

type Input = z.infer<typeof inputSchema>

export const PathJoinTool: Tool<Input, { path: string }> = {
  name: 'pathJoin',
  description:
    'Join multiple path segments into a single path using the correct platform-specific separator. ' +
    'ALWAYS use this instead of string concatenation (+) when building paths. ' +
    'String concatenation often produces broken paths like ".note_agentskills" instead of ".note_agent/skills".',
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

  async call(input): Promise<ToolResult<{ path: string }>> {
    const path = join(...input.segments)
    return {
      data: { path },
      preview: `Joined path: ${path}`,
    }
  },

  renderToolUse(input) {
    return `pathJoin(${input.segments.join(', ')})`
  },
}
