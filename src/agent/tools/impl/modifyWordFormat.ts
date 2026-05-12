import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { modifyParagraphFormat, modifyGlobalFormat } from '../../document'

const changeSchema = z.object({
  property: z.enum(['headingLevel', 'alignment', 'fontSize', 'bold', 'italic', 'color', 'indentation']),
  value: z.any().describe('The new value for the property. For headingLevel: 1-6 or null. For alignment: left/center/right/justify. For fontSize: number (half-points, e.g. 24 = 12pt). For bold/italic: boolean. For color: hex string without #, e.g. "FF0000". For indentation: { left?, right?, firstLine? } in twips.'),
})

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  target: z.union([
    z.object({ type: z.literal('paragraph'), paragraphIndex: z.number().describe('1-based paragraph number') }),
    z.object({ type: z.literal('global') }),
  ]),
  changes: z.array(changeSchema).describe('List of format changes to apply. Each change specifies a property and its new value.'),
})

type Input = z.infer<typeof inputSchema>

export const ModifyWordFormatTool: Tool<Input, { filePath: string; target: string }> = {
  name: 'modifyWordFormat',
  description:
    'Modify the formatting of a Word (.docx) document. ' +
    'Can target a specific paragraph or apply changes globally to all paragraphs. ' +
    'Supported properties: headingLevel (1-6 or null), alignment (left/center/right/justify), ' +
    'fontSize (half-points), bold (true/false), italic (true/false), color (hex like "FF0000"), ' +
    'indentation ({ left, right, firstLine } in twips). ' +
    'Use this instead of raw XML editing or generating temporary scripts.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    const targetDesc = input.target.type === 'global'
      ? 'all paragraphs'
      : `paragraph ${input.target.paragraphIndex}`
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Modify format of ${targetDesc} in ${input.filePath}`,
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; target: string }>> {
    const targetDesc = input.target.type === 'global' ? 'global' : `paragraph ${input.target.paragraphIndex}`

    let result: { success: boolean; error?: string }
    if (input.target.type === 'paragraph') {
      const zeroBasedIndex = Math.max(0, input.target.paragraphIndex - 1)
      result = await modifyParagraphFormat(input.filePath, zeroBasedIndex, input.changes, {
        tempBaseDir: ctx.workspacePath,
        beforeWrite: (originalBuffer) => {
          const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
          if (db?.pushFileHistory) {
            db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
          }
        },
      })
    } else {
      result = await modifyGlobalFormat(input.filePath, input.changes, {
        tempBaseDir: ctx.workspacePath,
        beforeWrite: (originalBuffer) => {
          const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
          if (db?.pushFileHistory) {
            db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
          }
        },
      })
    }

    if (result.success) {
      return {
        data: { filePath: input.filePath, target: targetDesc },
        preview: `Successfully modified format (${input.changes.map(c => c.property).join(', ')}) for ${targetDesc} in ${input.filePath}.`,
      }
    }
    return {
      data: { filePath: input.filePath, target: targetDesc },
      error: result.error || 'Failed to modify format',
    }
  },

  renderToolUse(input) {
    const target = input.target.type === 'global' ? 'global' : `paragraph ${input.target.paragraphIndex}`
    return `Modify format (${input.changes.map(c => c.property).join(', ')}) for ${target} in ${input.filePath}`
  },
}
