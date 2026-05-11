import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  query: z.string().describe('Search query text'),
  folderIds: z.array(z.number()).optional().describe('Optional list of folder IDs to search within. If omitted, uses the user-selected knowledge base folders from the data source panel.'),
  topK: z.number().int().min(1).max(20).optional().describe('Number of results to return (default 5)'),
})

type Input = z.infer<typeof inputSchema>

export const SearchKnowledgeBaseTool: Tool<Input, { results: Array<{ filePath: string; content: string; score: number }> }> = {
  name: 'searchKnowledgeBase',
  description:
    'Search the local knowledge base for relevant information. ' +
    'Use this when the user asks about content that might be in their indexed local folders. ' +
    'Returns text chunks with file paths and relevance scores.',
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ results: Array<{ filePath: string; content: string; score: number }> }>> {
    try {
      const { searchKnowledgeBase } = require('../../../main/knowledge-base')
      const { getDb } = require('../../../main/db')
      const db = getDb ? getDb() : (global as any).__db
      if (!db) {
        return { data: { results: [] }, error: 'Knowledge base not available' }
      }

      // Fall back to user-selected data sources if model doesn't specify folderIds
      const folderIds = input.folderIds ?? ctx.dataSources?.kbFolderIds

      const results = await searchKnowledgeBase(input.query, db, {
        folderIds,
        topK: input.topK ?? 5,
      })

      return {
        data: {
          results: results.map((r: any) => ({
            filePath: r.filePath,
            content: r.content,
            score: r.score,
          })),
        },
      }
    } catch (err: any) {
      return { data: { results: [] }, error: err.message || 'Knowledge base search failed' }
    }
  },

  renderToolUse(input) {
    return `Search knowledge base: "${input.query}"`
  },
}
