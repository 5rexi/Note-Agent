/**
 * LSP Client 测试
 */
import { describe, it, expect } from 'bun:test'
import { LSPClient } from './client'

describe('LSPClient', () => {
  it('should instantiate without connecting', () => {
    const client = new LSPClient('typescript-language-server', ['--stdio'])
    expect(client.isInitialized()).toBe(false)
  })

  it('should track initialization state', () => {
    const client = new LSPClient('echo')
    // Not connected, so not initialized
    expect(client.isInitialized()).toBe(false)
  })
})
