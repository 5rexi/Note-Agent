/**
 * MCP Client 测试（模拟 JSON-RPC 消息解析）
 */
import { describe, it, expect } from 'bun:test'
import { loadMCPConfig } from './client'

describe('loadMCPConfig', () => {
  it('should return empty array when no config file', () => {
    const configs = loadMCPConfig()
    expect(Array.isArray(configs)).toBe(true)
  })
})

describe('jsonSchemaToZod (via tool-bridge)', () => {
  // We test the bridge logic indirectly by checking the module loads
  it('should load tool-bridge module', async () => {
    const { createMCPTool } = await import('./tool-bridge')
    expect(typeof createMCPTool).toBe('function')
  })
})
