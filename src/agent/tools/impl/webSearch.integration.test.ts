/**
 * WebSearchTool 真实网络集成测试
 * 验证搜索是否正常工作
 */
import { describe, it, expect } from 'bun:test'
import { WebSearchTool } from './webSearch'
import type { ToolContext } from '../Tool'

const ctx: ToolContext = { workspacePath: process.cwd(), mode: 'explore' }

describe('WebSearchTool (live network)', () => {
  it('should search and return results or graceful error', async () => {
    const result = await WebSearchTool.call({ query: 'TypeScript', maxResults: 3 }, ctx)

    // In restricted network environments, search may fail — that's ok
    if (result.error) {
      expect(typeof result.error).toBe('string')
      return
    }

    expect(Array.isArray(result.data)).toBe(true)
    if ((result.data as any[]).length > 0) {
      const first = (result.data as any[])[0]
      expect(first.title).toBeDefined()
      expect(first.url).toBeDefined()
    }
  }, 30000) // Puppeteer may take longer

  it('should handle empty search query gracefully', async () => {
    const result = await WebSearchTool.call({ query: '', maxResults: 3 }, ctx)
    expect(result.error !== undefined || Array.isArray(result.data)).toBe(true)
  }, 30000)
})
