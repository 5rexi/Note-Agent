import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import {
  openDocx,
  closeDocx,
  getDocumentOutline,
  getDocumentText,
  getDocumentStats,
  getDocumentIssues,
  type DocumentRun,
} from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  mode: z.enum(['outline', 'text', 'stats', 'issues']).describe(
    'View mode: outline=heading hierarchy (most compact), text=all paragraphs with paths, stats=document statistics, issues=detected problems'
  ),
})

type Input = z.infer<typeof inputSchema>

export const WordViewTool: Tool<Input, { mode: string; result: any }> = {
  name: 'wordView',
  description:
    'Get a compact view of a Word (.docx) document. ' +
    'Use "outline" for heading hierarchy (most token-efficient), ' +
    '"text" for all paragraphs with their paths, ' +
    '"stats" for document statistics, ' +
    '"issues" for detected problems. ' +
    'This is the starting point for any Word document workflow — use it to understand the document before modifying.',
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ mode: string; result: any }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { mode: input.mode, result: null },
        error: error!.message,
      }
    }

    try {
      switch (input.mode) {
        case 'outline': {
          const outline = getDocumentOutline(doc.body)
          return {
            data: { mode: 'outline', result: outline },
            preview: `Outline: ${outline.length} headings\n` + outline.map(h => `${'  '.repeat(h.level - 1)}${h.level}. ${h.text}`).join('\n'),
          }
        }
        case 'text': {
          const paragraphs = getDocumentText(doc.body)
          return {
            data: { mode: 'text', result: paragraphs },
            preview: `Text: ${paragraphs.length} paragraphs\n` + paragraphs.slice(0, 10).map(p => {
              const runsInfo = p.runs ? ` [${p.runs.length} runs]` : ''
              return `[${p.index}]${runsInfo} ${p.text.slice(0, 80)}${p.text.length > 80 ? '...' : ''}`
            }).join('\n') + (paragraphs.length > 10 ? `\n... (${paragraphs.length - 10} more)` : ''),
          }
        }
        case 'stats': {
          const stats = getDocumentStats(doc.body)
          return {
            data: { mode: 'stats', result: stats },
            preview: `Stats: ${stats.wordCount} words, ${stats.paragraphCount} paragraphs, ${stats.headingCount} headings, ${stats.tableCount} tables, ${stats.imageCount} images`,
          }
        }
        case 'issues': {
          const issues = getDocumentIssues(doc.body)
          return {
            data: { mode: 'issues', result: issues },
            preview: issues.length === 0 ? 'No issues detected' : `Issues: ${issues.length} found\n` + issues.slice(0, 5).map(i => `- [${i.type}] ${i.message}`).join('\n'),
          }
        }
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordView ${input.filePath} --mode ${input.mode}`
  },
}
