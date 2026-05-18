import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, closeDocx, resolvePath, getElementInfo } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Path to the .docx file (relative to workspace or absolute)'),
  path: z.string().describe('Element path, e.g. /body/p[1] or /body/p[1]/r[1] or /body/tbl[1]'),
  depth: z.number().optional().describe('How many levels of children to include (default: 0 = target element only)'),
})

type Input = z.infer<typeof inputSchema>

export const WordGetTool: Tool<Input, { path: string; element: any }> = {
  name: 'wordGet',
  description:
    'Get detailed information about an element at a specific path in a Word document. ' +
    'Returns the element\'s tag, text content, attributes, and optionally its children. ' +
    'Use wordView outline first to discover paths, then wordGet to inspect specific elements.',
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions(_input, ctx) {
    if (ctx.mode === 'explore') return { result: 'allow' }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; element: any }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { path: input.path, element: null },
        error: error!.message,
      }
    }

    try {
      const resolved = resolvePath(doc, input.path)
      if (resolved.error) {
        return {
          data: { path: input.path, element: null },
          error: `[${resolved.error.code}] ${resolved.error.message}${resolved.error.suggestion ? '\nSuggestion: ' + resolved.error.suggestion : ''}`,
        }
      }

      if (!resolved.element) {
        return {
          data: { path: input.path, element: null },
          error: `Element not found at ${input.path}`,
        }
      }

      const info = getElementInfo(resolved.element, input.path, (input.depth ?? 0) > 0)
      return {
        data: { path: input.path, element: info },
        preview: `${info.tag} @ ${info.path}\nText: ${info.text?.slice(0, 120) || '(none)'}${info.text && info.text.length > 120 ? '...' : ''}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordGet ${input.filePath} ${input.path}${input.depth ? ` --depth ${input.depth}` : ''}`
  },
}
