/**
 * 轻量级 MCP Client — 支持 stdio 和 SSE 传输
 *
 * MCP 协议 (Model Context Protocol):
 * - JSON-RPC 2.0 over stdio 或 SSE
 * - 初始化 → list tools → call tool
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface MCPServerConfig {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export class MCPClient {
  private config: MCPServerConfig
  private process?: ChildProcess
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>()
  private buffer = ''
  private tools: MCPTool[] = []
  private connected = false

  constructor(config: MCPServerConfig) {
    this.config = config
  }

  getName(): string {
    return this.config.name
  }

  isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<void> {
    if (this.config.transport === 'stdio') {
      await this.connectStdio()
    } else if (this.config.transport === 'sse') {
      await this.connectSSE()
    }
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error('MCP stdio transport requires command')
    }

    this.process = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8')
      this.processBuffer()
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      // Log stderr for debugging
      console.error(`[MCP ${this.config.name}] ${data.toString('utf-8').trim()}`)
    })

    this.process.on('error', (err) => {
      console.error(`[MCP ${this.config.name}] Process error:`, err.message)
    })

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[MCP ${this.config.name}] Process exited with code ${code}`)
      }
      this.connected = false
    })

    // Send initialize request
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'note-agent', version: '0.2.0' },
    })

    this.connected = true
  }

  private async connectSSE(): Promise<void> {
    const { MCPSSEClient } = await import('./sse-client')
    const sse = new MCPSSEClient(this.config)
    await sse.connect()
    // Bridge SSE client's request method to our sendRequest
    this.connected = true
    // Store SSE client for later use
    ;(this as any)._sseClient = sse
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed)
        this.handleMessage(msg)
      } catch {
        // Skip invalid JSON
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!
      this.pendingRequests.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message || 'MCP error'))
      } else {
        resolve(msg.result)
      }
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })

      const msg = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      if (this.process?.stdin?.writable) {
        this.process.stdin.write(JSON.stringify(msg) + '\n')
      } else {
        reject(new Error('MCP process not writable'))
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) throw new Error('MCP client not connected')

    const sseClient = (this as any)._sseClient as import('./sse-client').MCPSSEClient | undefined
    if (sseClient) {
      this.tools = await sseClient.listTools()
      return this.tools
    }

    const result = await this.sendRequest('tools/list')
    this.tools = result?.tools?.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    })) || []

    return this.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.connected) throw new Error('MCP client not connected')

    const sseClient = (this as any)._sseClient as import('./sse-client').MCPSSEClient | undefined
    if (sseClient) {
      return sseClient.callTool(name, args)
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })

    return result
  }

  async listResources(): Promise<any[]> {
    if (!this.connected) throw new Error('MCP client not connected')

    const sseClient = (this as any)._sseClient as import('./sse-client').MCPSSEClient | undefined
    if (sseClient) {
      return sseClient.listResources()
    }

    try {
      const result = await this.sendRequest('resources/list')
      return result?.resources || []
    } catch {
      return []
    }
  }

  async readResource(uri: string): Promise<any> {
    if (!this.connected) throw new Error('MCP client not connected')

    const sseClient = (this as any)._sseClient as import('./sse-client').MCPSSEClient | undefined
    if (sseClient) {
      return sseClient.readResource(uri)
    }

    try {
      return await this.sendRequest('resources/read', { uri })
    } catch {
      return null
    }
  }

  getTools(): MCPTool[] {
    return [...this.tools]
  }

  async disconnect(): Promise<void> {
    this.connected = false
    const sseClient = (this as any)._sseClient as import('./sse-client').MCPSSEClient | undefined
    if (sseClient) {
      await sseClient.disconnect()
      ;(this as any)._sseClient = undefined
    }
    if (this.process) {
      this.process.kill()
      // Force kill after 5s (SIGTERM is not graceful on Windows, so both calls do the same there)
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill()
        }
      }, 5000)
    }
    this.pendingRequests.clear()
  }
}

// ── Config Loading ──

export function loadMCPConfig(): MCPServerConfig[] {
  const configPath = join(homedir(), '.note_agent', 'mcp.json')
  if (!existsSync(configPath)) return []

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return parsed.servers || []
  } catch {
    return []
  }
}
