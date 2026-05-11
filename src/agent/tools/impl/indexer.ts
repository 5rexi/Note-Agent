/**
 * Indexer 工具 — 创建和查询文件索引
 * 参考 design.md "Advanced Tooling" / "Indexer"
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../Tool'

const inputSchema = z.object({
  operation: z.enum(['create', 'query', 'delete']).describe('操作类型'),
  indexName: z.string().describe('索引名称'),
  files: z.array(z.string()).optional().describe('创建索引时包含的文件路径'),
  query: z.string().optional().describe('查询关键词'),
})

interface IndexEntry {
  path: string
  content: string
  tokens: number
}

const indexes = new Map<string, IndexEntry[]>()

export class IndexerTool implements Tool<z.infer<typeof inputSchema>, unknown> {
  readonly name = 'Indexer'
  readonly description = '创建和查询文件索引，用于高效搜索'
  readonly inputSchema = inputSchema

  isReadOnly(): boolean { return false }
  isConcurrencySafe(): boolean { return false }
  isDestructive(): boolean { return false }

  checkPermissions(): { result: 'allow' } {
    return { result: 'allow' }
  }

  validateInput(raw: unknown): z.infer<typeof inputSchema> {
    return this.inputSchema.parse(raw)
  }

  async call(input: z.infer<typeof inputSchema>, ctx: ToolContext): Promise<ToolResult<unknown>> {
    const { operation, indexName } = input

    if (operation === 'create') {
      const entries: IndexEntry[] = []
      for (const filePath of input.files || []) {
        try {
          const fullPath = ctx.workspacePath ? `${ctx.workspacePath}/${filePath}` : filePath
          const content = await Bun.file(fullPath).text()
          entries.push({ path: filePath, content, tokens: Math.ceil(content.length / 4) })
        } catch {
          // Skip unreadable files
        }
      }
      indexes.set(indexName, entries)
      return { data: { created: entries.length, indexName } }
    }

    if (operation === 'query') {
      const entries = indexes.get(indexName) || []
      const q = (input.query || '').toLowerCase()
      const matches = entries.filter((e) =>
        e.path.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
      )
      return { data: { matches: matches.map((m) => ({ path: m.path, tokens: m.tokens })) } }
    }

    if (operation === 'delete') {
      const existed = indexes.delete(indexName)
      return { data: { deleted: existed } }
    }

    return { data: { error: 'Unknown operation' } }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `索引${input.operation}: ${input.indexName}`
  }
}
