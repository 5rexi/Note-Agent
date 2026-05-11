/**
 * OpenAPI Client Tool — 动态生成 HTTP 调用
 * 参考 design.md "External Tools"
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../Tool'

const inputSchema = z.object({
  specUrl: z.string().optional().describe('OpenAPI spec URL'),
  operationId: z.string().describe('操作ID'),
  parameters: z.record(z.string(), z.any()).default({}).describe('请求参数'),
})

export class OpenApiClientTool implements Tool<z.infer<typeof inputSchema>, unknown> {
  readonly name = 'OpenApiClient'
  readonly description = '调用外部 OpenAPI 端点'
  readonly inputSchema = inputSchema

  isReadOnly(): boolean { return false }
  isConcurrencySafe(): boolean { return true }
  isDestructive(): boolean { return false }

  checkPermissions(): { result: 'ask'; description: string } {
    return { result: 'ask', description: 'OpenAPI 外部调用' }
  }

  validateInput(raw: unknown): z.infer<typeof inputSchema> {
    return this.inputSchema.parse(raw)
  }

  async call(input: z.infer<typeof inputSchema>): Promise<ToolResult<unknown>> {
    // 简化实现：直接返回说明
    return {
      data: {
        message: `OpenAPI call to ${input.operationId}`,
        parameters: input.parameters,
        note: 'Full OpenAPI client requires spec caching and schema validation (future enhancement)',
      },
    }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `OpenAPI调用: ${input.operationId}`
  }
}
