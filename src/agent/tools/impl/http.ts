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
    // SSRF protection: block internal/private IP ranges and file:// protocol
    const urlStr = input.url.trim()
    let urlObj: URL
    try {
      urlObj = new URL(urlStr)
    } catch {
      return { data: { status: 0, body: '', headers: {} }, error: `Invalid URL: ${urlStr}` }
    }

    const blockedProtocols = ['file:', 'ftp:', 'gopher:', 'data:']
    if (blockedProtocols.includes(urlObj.protocol)) {
      return { data: { status: 0, body: '', headers: {} }, error: `Protocol not allowed: ${urlObj.protocol}` }
    }

    const hostname = urlObj.hostname.toLowerCase()
    // Block localhost and private IP ranges
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname === '0.0.0.0'
    ) {
      return { data: { status: 0, body: '', headers: {} }, error: `Access to internal addresses is not allowed: ${hostname}` }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers as Record<string, string>,
        body: input.body,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const body = await response.text()
      const headers: Record<string, string> = {}
      response.headers.forEach((v, k) => { headers[k] = v })

      return {
        data: { status: response.status, body, headers },
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        return { data: { status: 0, body: '', headers: {} }, error: 'Request timed out after 30s' }
      }
      return { data: { status: 0, body: '', headers: {} }, error: `HTTP request failed: ${err.message}` }
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
