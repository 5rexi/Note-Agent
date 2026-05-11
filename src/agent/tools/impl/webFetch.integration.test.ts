/**
 * WebFetchTool 真实网络集成测试
 * 验证实际 HTTP 请求和 HTML/JSON 解析
 */
import { describe, it, expect } from 'bun:test'
import { WebFetchTool } from './webFetch'
import type { ToolContext } from '../Tool'

const ctx: ToolContext = { workspacePath: process.cwd(), mode: 'explore' }

describe('WebFetchTool (live network)', () => {
  it('should fetch a simple HTML page', async () => {
    const result = await WebFetchTool.call({ url: 'https://example.com' }, ctx)
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(typeof result.data).toBe('string')
    expect((result.data as string).length).toBeGreaterThan(0)
    expect((result.data as string)).toContain('Example') // example.com has this text
  })

  it('should fetch JSON and pretty-print', async () => {
    const result = await WebFetchTool.call({ url: 'https://httpbin.org/json' }, ctx)
    expect(result.error).toBeUndefined()
    expect(typeof result.data).toBe('string')
    // Should be pretty-printed JSON
    expect((result.data as string)).toContain('"')
  })

  it('should handle 404 errors gracefully', async () => {
    const result = await WebFetchTool.call({ url: 'https://httpbin.org/status/404' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('404')
  })

  it('should handle invalid URLs', async () => {
    const result = await WebFetchTool.call({ url: 'not-a-valid-url' }, ctx)
    expect(result.error).toBeDefined()
  })

  it('should respect maxChars limit', async () => {
    const result = await WebFetchTool.call(
      { url: 'https://example.com', maxChars: 50 },
      ctx,
    )
    expect(result.error).toBeUndefined()
    expect((result.data as string).length).toBeLessThanOrEqual(100) // 50 + some slack for truncation notice
  })

  it('should handle redirects', async () => {
    const result = await WebFetchTool.call(
      { url: 'https://httpbin.org/redirect/2' },
      ctx,
    )
    expect(result.error).toBeUndefined()
    expect((result.data as string).length).toBeGreaterThan(0)
  })
})
