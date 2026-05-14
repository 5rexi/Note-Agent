import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  path: z.string().describe('Path of element to remove, e.g. /body/p[3] or /body/p[1]/r[2]'),
})

type Input = z.infer<typeof inputSchema>

export const WordRemoveTool: Tool<Input, { filePath: string; path: string }> = {
  name: 'wordRemove',
  description:
    'Remove an element at a specific path from a Word document. ' +
    'Use wordQuery to find the correct path first. ' +
    'Removing a paragraph shifts indices of subsequent paragraphs.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Remove ${input.path} from ${input.filePath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; path: string }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, path: input.path },
        error: error!.message,
      }
    }

    try {
      const resolved = resolvePath(doc, input.path)
      if (resolved.error || !resolved.element) {
        return {
          data: { filePath: input.filePath, path: input.path },
          error: resolved.error
            ? `[${resolved.error.code}] ${resolved.error.message}${resolved.error.suggestion ? '\nSuggestion: ' + resolved.error.suggestion : ''}`
            : `Element not found at ${input.path}`,
        }
      }

      const parent = resolved.parent
      if (!parent) {
        return {
          data: { filePath: input.filePath, path: input.path },
          error: 'Cannot remove root element',
        }
      }

      parent.removeChild(resolved.element)
      doc.isDirty = true

      const saveResult = await saveDocx(doc)
      if (!saveResult.success) {
        return {
          data: { filePath: input.filePath, path: input.path },
          error: saveResult.error?.message || 'Failed to save document',
        }
      }

      return {
        data: { filePath: input.filePath, path: input.path },
        preview: `Removed ${input.path}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordRemove ${input.filePath} ${input.path}`
  },
}
