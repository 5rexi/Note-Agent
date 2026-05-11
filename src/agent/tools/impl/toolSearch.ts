/**
 * ToolSearch 工具 — 在工具名称/描述中搜索
 * 参考 design.md "搜索工具"
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../Tool'
import { getAllTools } from '../registry'

const inputSchema = z.object({
  query: z.string().describe('搜索关键词'),
})

export class ToolSearchTool implements Tool<z.infer<typeof inputSchema>, { results: Array<{ name: string; description: string }> }> {
  readonly name = 'ToolSearch'
  readonly description = '在可用工具中搜索，找到匹配名称或描述的工具'
  readonly inputSchema = inputSchema

  isReadOnly(): boolean { return true }
  isConcurrencySafe(): boolean { return true }
  isDestructive(): boolean { return false }

  checkPermissions(): { result: 'allow' } {
    return { result: 'allow' }
  }

  validateInput(raw: unknown): z.infer<typeof inputSchema> {
    return this.inputSchema.parse(raw)
  }

  async call(input: z.infer<typeof inputSchema>): Promise<ToolResult<{ results: Array<{ name: string; description: string }> }>> {
    const q = input.query.toLowerCase()
    const all = getAllTools()
    const results = all
      .filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .map((t) => ({ name: t.name, description: t.description }))

    return {
      data: { results },
    }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `搜索工具: "${input.query}"`
  }

  renderToolResult(result: ToolResult<{ results: Array<{ name: string; description: string }> }>): string {
    const data = result.data
    if (!data || data.results.length === 0) return '未找到匹配的工具'
    return data.results.map((r) => `• ${r.name}: ${r.description}`).join('\n')
  }
}
