import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { replaceParagraphText } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  paragraphIndex: z.number().describe('1-based paragraph number as shown in document structure analysis (e.g., paragraph 3 means index 3)'),
  newText: z.string().describe('New text content for the paragraph'),
})

type Input = z.infer<typeof inputSchema>

// Track successful replacements per session to detect duplicates
const replacedParagraphs = new Map<string, Set<number>>()

function getSessionKey(ctx: ToolContext): string {
  return ctx.sessionId || ctx.workspacePath || 'default'
}

export const ReplaceWordParagraphTool: Tool<Input, { filePath: string; paragraphIndex: number; alreadyReplaced?: boolean }> = {
  name: 'replaceWordParagraph',
  description:
    'Replace the text of a specific paragraph in a Word (.docx) document. ' +
    'This preserves the original formatting (styles, fonts, margins, spacing, etc.). ' +
    'The paragraphIndex is 1-based (as shown in document structure analysis, e.g., paragraph 3 → use 3). ' +
    'Use this instead of writeFile/editFile when modifying .docx files to avoid corrupting the document. ' +
    'Do NOT call this tool multiple times for the same paragraph unless the user explicitly asks for further changes.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Replace paragraph ${input.paragraphIndex} in ${input.filePath}`,
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; paragraphIndex: number; alreadyReplaced?: boolean }>> {
    const key = getSessionKey(ctx)
    const fileKey = `${key}::${input.filePath}`
    const replaced = replacedParagraphs.get(fileKey) || new Set()

    // Detect duplicate replacement for the same paragraph
    if (replaced.has(input.paragraphIndex)) {
      return {
        data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex, alreadyReplaced: true },
        preview: `Paragraph ${input.paragraphIndex} was already replaced earlier in this session. If the task is complete, call done.`,
      }
    }

    // paragraphIndex is 1-based (as shown to the user), convert to 0-based for the engine
    const zeroBasedIndex = Math.max(0, input.paragraphIndex - 1)
    const result = await replaceParagraphText(input.filePath, zeroBasedIndex, input.newText, {
      tempBaseDir: ctx.workspacePath,
      beforeWrite: (originalBuffer) => {
        // Save undo history when running inside the Electron main process
        const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
        if (db?.pushFileHistory) {
          db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
        }
      },
    })
    if (result.success) {
      replaced.add(input.paragraphIndex)
      replacedParagraphs.set(fileKey, replaced)
      return {
        data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
        preview: `Successfully replaced paragraph ${input.paragraphIndex} in ${input.filePath}. The document has been updated.`,
      }
    }
    return {
      data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
      error: result.error || 'Failed to replace paragraph',
    }
  },

  renderToolUse(input) {
    return `Replace paragraph ${input.paragraphIndex} in ${input.filePath}`
  },
}
