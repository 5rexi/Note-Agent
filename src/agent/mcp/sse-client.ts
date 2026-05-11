/**
 * MCP SSE Client — Server-Sent Events 传输
 * 参考设计文档第08章
 */

import type { MCPServerConfig, MCPTool } from './client'

export class MCPSSEClient {
  private config: MCPServerConfig
  private eventSource?: EventSource
  private tools: MCPTool[] = []
  private connected = false
  private messageId = 0
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>()

  constructor(config: MCPServerConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('MCP SSE transport requires url')
    }

    // SSE endpoint: connect to the SSE endpoint, get the message endpoint
    const res = await fetch(this.config.url)
    if (!res.ok) {
      throw new Error(`SSE connect failed: ${res.status}`)
    }

    // For simplicity, we use a polling approach over HTTP POST
    // Full SSE implementation would use EventSource for streaming
    this.connected = true
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.connected) throw new Error('MCP SSE client not connected')
    if (!this.config.url) throw new Error('No URL configured')

    const id = ++this.messageId
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`SSE request failed: ${res.status}`)
    }

    return res.json()
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list')
    this.tools = result?.tools?.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    })) || []
    return this.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.sendRequest('tools/call', { name, arguments: args })
  }

  async listResources(): Promise<any[]> {
    const result = await this.sendRequest('resources/list')
    return result?.resources || []
  }

  async readResource(uri: string): Promise<any> {
    return this.sendRequest('resources/read', { uri })
  }

  getTools(): MCPTool[] {
    return [...this.tools]
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.pendingRequests.clear()
  }

  isConnected(): boolean {
    return this.connected
  }
}
