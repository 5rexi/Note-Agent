import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { deleteParagraph } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  paragraphIndex: z.number().describe('1-based paragraph number to delete (as shown in document structure analysis)'),
})

type Input = z.infer<typeof inputSchema>

// Track deleted paragraphs per session to detect duplicates
const deletedParagraphs = new Map<string, Set<number>>()

function getSessionKey(ctx: ToolContext): string {
  return ctx.sessionId || ctx.workspacePath || 'default'
}

export const DeleteWordParagraphTool: Tool<Input, { filePath: string; paragraphIndex: number; alreadyDeleted?: boolean }> = {
  name: 'deleteWordParagraph',
  description:
    'Delete a specific paragraph from a Word (.docx) document. ' +
    'The paragraphIndex is 1-based (as shown in document structure analysis). ' +
    'This is destructive and shifts the indices of subsequent paragraphs. ' +
    'Do NOT call this tool multiple times for the same paragraph unless the user explicitly asks for further changes.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Delete paragraph ${input.paragraphIndex} from ${input.filePath}`,
      }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; paragraphIndex: number; alreadyDeleted?: boolean }>> {
    const key = getSessionKey(ctx)
    const fileKey = `${key}::${input.filePath}`
    const deleted = deletedParagraphs.get(fileKey) || new Set()

    if (deleted.has(input.paragraphIndex)) {
      return {
        data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex, alreadyDeleted: true },
        preview: `Paragraph ${input.paragraphIndex} was already deleted earlier in this session. If the task is complete, call done.`,
      }
    }

    const zeroBasedIndex = Math.max(0, input.paragraphIndex - 1)
    const result = await deleteParagraph(input.filePath, zeroBasedIndex, {
      tempBaseDir: ctx.workspacePath,
      beforeWrite: (originalBuffer) => {
        const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
        if (db?.pushFileHistory) {
          db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
        }
      },
    })
    if (result.success) {
      deleted.add(input.paragraphIndex)
      deletedParagraphs.set(fileKey, deleted)
      return {
        data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
        preview: `Successfully deleted paragraph ${input.paragraphIndex} from ${input.filePath}.`,
      }
    }
    return {
      data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
      error: result.error || 'Failed to delete paragraph',
    }
  },

  renderToolUse(input) {
    return `Delete paragraph ${input.paragraphIndex} from ${input.filePath}`
  },
}
