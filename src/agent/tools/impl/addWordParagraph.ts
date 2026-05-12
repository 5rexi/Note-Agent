import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { addParagraphText } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  paragraphIndex: z.number().describe('1-based paragraph number to insert BEFORE (e.g., use 3 to insert before paragraph 3). Use a number greater than the total count to append at the end.'),
  text: z.string().describe('Text content for the new paragraph'),
})

type Input = z.infer<typeof inputSchema>

export const AddWordParagraphTool: Tool<Input, { filePath: string; paragraphIndex: number }> = {
  name: 'addWordParagraph',
  description:
    'Insert a new paragraph before a specific paragraph in a Word (.docx) document. ' +
    'The new paragraph inherits formatting (style, font, spacing) from the previous paragraph. ' +
    'The paragraphIndex is 1-based (as shown in document structure analysis). ' +
    'Use a paragraphIndex larger than the total paragraph count to append at the end of the document.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Add paragraph before index ${input.paragraphIndex} in ${input.filePath}`,
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; paragraphIndex: number }>> {
    const zeroBasedIndex = Math.max(0, input.paragraphIndex - 1)
    const result = await addParagraphText(input.filePath, zeroBasedIndex, input.text, {
      tempBaseDir: ctx.workspacePath,
      beforeWrite: (originalBuffer) => {
        const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
        if (db?.pushFileHistory) {
          db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
        }
      },
    })
    if (result.success) {
      return {
        data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
        preview: `Successfully added a new paragraph before paragraph ${input.paragraphIndex} in ${input.filePath}.`,
      }
    }
    return {
      data: { filePath: input.filePath, paragraphIndex: input.paragraphIndex },
      error: result.error || 'Failed to add paragraph',
    }
  },

  renderToolUse(input) {
    return `Add paragraph before index ${input.paragraphIndex} in ${input.filePath}`
  },
}
