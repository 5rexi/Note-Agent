import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, closeDocx, queryElements, getElementInfo } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  selector: z.string().describe(
    'CSS-like selector. Examples:\n' +
    '  "paragraph" → all paragraphs\n' +
    '  "paragraph[style=Heading1]" → paragraphs with Heading1 style\n' +
    '  "run:contains(\'TODO\')" → runs containing "TODO"\n' +
    '  "table" → all tables\n' +
    '  "paragraph[alignment=center]" → center-aligned paragraphs\n' +
    '  "paragraph:has(run[bold=true])" → paragraphs containing bold runs'
  ),
  limit: z.number().optional().describe('Max results to return (default: 20)'),
})

type Input = z.infer<typeof inputSchema>

export const WordQueryTool: Tool<Input, { filePath: string; selector: string; matches: any[] }> = {
  name: 'wordQuery',
  description:
    'Query elements in a Word document using CSS-like selectors. ' +
    'Returns matching elements with their paths and attributes. ' +
    'Use this to find elements before modifying them with wordSet. ' +
    'Always use wordQuery to discover element paths rather than guessing indices.',
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; selector: string; matches: any[] }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, selector: input.selector, matches: [] },
        error: error!.message,
      }
    }

    try {
      const { elements, error: queryError } = queryElements(doc.body, input.selector)
      if (queryError) {
        return {
          data: { filePath: input.filePath, selector: input.selector, matches: [] },
          error: `[${queryError.code}] ${queryError.message}`,
        }
      }

      const limit = input.limit ?? 20
      const matches = elements.slice(0, limit).map(({ element, path }) =>
        getElementInfo(element, path, false)
      )

      return {
        data: { filePath: input.filePath, selector: input.selector, matches },
        preview: `Query "${input.selector}": ${elements.length} matches${elements.length > limit ? ` (showing first ${limit})` : ''}\n` +
          matches.slice(0, 10).map(m => `- ${m.path}: ${m.text?.slice(0, 60) || '(empty)'}`).join('\n'),
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordQuery ${input.filePath} "${input.selector}"${input.limit ? ` --limit ${input.limit}` : ''}`
  },
}
