/**
 * HTTP 工具 — 通用 HTTP 请求
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../Tool'

const inputSchema = z.object({
  url: z.string().describe('目标 URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
})

export class HttpTool implements Tool<z.infer<typeof inputSchema>, { status: number; body: string; headers: Record<string, string> }> {
  readonly name = 'Http'
  readonly description = '执行通用 HTTP 请求（GET/POST/PUT/DELETE/PATCH）'
  readonly inputSchema = inputSchema

  isReadOnly(): boolean { return false }
  isConcurrencySafe(): boolean { return true }
  isDestructive(): boolean { return false }

  checkPermissions(input: z.infer<typeof inputSchema>): { result: 'allow' } | { result: 'ask'; description: string } {
    // Destructive methods need ask
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(input.method)) {
      return { result: 'ask', description: `HTTP ${input.method} ${input.url}` }
    }
    return { result: 'allow' }
  }

  validateInput(raw: unknown): z.infer<typeof inputSchema> {
    return this.inputSchema.parse(raw)
  }

  async call(input: z.infer<typeof inputSchema>): Promise<ToolResult<{ status: number; body: string; headers: Record<string, string> }>> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers as Record<string, string>,
      body: input.body,
    })

    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((v, k) => { headers[k] = v })

    return {
      data: { status: response.status, body, headers },
    }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `HTTP ${input.method} ${input.url}`
  }

  renderToolResult(result: ToolResult<{ status: number; body: string; headers: Record<string, string> }>): string {
    const data = result.data
    if (!data) return 'No response data'
    return `Status: ${data.status}\nBody: ${data.body.slice(0, 500)}${data.body.length > 500 ? '...' : ''}`
  }
}
