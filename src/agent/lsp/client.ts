/**
 * LSP Client — 轻量级 Language Server Protocol 客户端
 * 参考 design.md "LSP Integration"
 *
 * 功能：
 * - 启动语言服务器（stdio 传输）
 * - 发送 initialize 请求
 * - 支持 textDocument/definition、hover、diagnostics
 */

import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

export interface LSPPosition {
  line: number
  character: number
}

export interface LSPLocation {
  uri: string
  range: { start: LSPPosition; end: LSPPosition }
}

export interface LSPDiagnostic {
  range: { start: LSPPosition; end: LSPPosition }
  severity: 1 | 2 | 3 | 4 // Error | Warning | Information | Hint
  message: string
  source?: string
  code?: string
}

interface LSPMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string }
}

export class LSPClient extends EventEmitter {
  private process?: ChildProcess
  private buffer = ''
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>()
  private documentVersions = new Map<string, number>()
  private initialized = false
  private serverCapabilities: any = {}

  constructor(
    private command: string,
    private args: string[] = [],
    private rootUri?: string,
  ) {
    super()
  }

  async connect(): Promise<void> {
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8')
      this.processBuffer()
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim()
      if (text) this.emit('log', `[stderr] ${text}`)
    })

    this.process.on('exit', (code) => {
      this.emit('log', `LSP server exited with code ${code}`)
      this.initialized = false
    })

    // Send initialize
    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.rootUri || `file://${process.cwd()}`,
      workspaceFolders: this.rootUri ? [{ uri: this.rootUri, name: 'workspace' }] : undefined,
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
    })

    this.serverCapabilities = result.capabilities || {}
    this.initialized = true

    // Send initialized notification
    this.sendNotification('initialized', {})
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = this.buffer.slice(0, headerEnd)
      const contentLengthMatch = header.match(/Content-Length: (\d+)/)
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const messageStart = headerEnd + 4
      if (this.buffer.length < messageStart + contentLength) break

      const messageStr = this.buffer.slice(messageStart, messageStart + contentLength)
      this.buffer = this.buffer.slice(messageStart + contentLength)

      try {
        const msg: LSPMessage = JSON.parse(messageStr)
        this.handleMessage(msg)
      } catch {
        // Skip invalid JSON
      }
    }
  }

  private handleMessage(msg: LSPMessage): void {
    // Handle server-initiated messages
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params?.uri
      const diagnostics: LSPDiagnostic[] = msg.params?.diagnostics || []
      this.emit('diagnostics', { uri, diagnostics })
      return
    }

    // Handle responses
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!
      this.pendingRequests.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message))
      } else {
        resolve(msg.result)
      }
    }
  }

  private sendMessage(msg: Omit<LSPMessage, 'jsonrpc'>): void {
    const fullMsg = { jsonrpc: '2.0', ...msg }
    const payload = JSON.stringify(fullMsg)
    const data = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(data)
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })
      this.sendMessage({ id, method, params })

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`LSP request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  private sendNotification(method: string, params?: any): void {
    this.sendMessage({ method, params })
  }

  async openDocument(uri: string, languageId: string, text: string): Promise<void> {
    this.documentVersions.set(uri, 1)
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  }

  async changeDocument(uri: string, text: string): Promise<void> {
    const version = (this.documentVersions.get(uri) || 0) + 1
    this.documentVersions.set(uri, version)
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  async getDefinition(uri: string, position: LSPPosition): Promise<LSPLocation[]> {
    if (!this.serverCapabilities.definitionProvider) return []
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position,
    })
  }

  async getHover(uri: string, position: LSPPosition): Promise<{ contents: string } | null> {
    if (!this.serverCapabilities.hoverProvider) return null
    const result = await this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position,
    })
    if (!result) return null
    return { contents: typeof result.contents === 'string' ? result.contents : JSON.stringify(result.contents) }
  }

  async getDocumentSymbols(uri: string): Promise<any[]> {
    if (!this.serverCapabilities.documentSymbolProvider) return []
    return this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    })
  }

  async getCompletions(uri: string, position: LSPPosition): Promise<any[]> {
    if (!this.serverCapabilities.completionProvider) return []
    const result = await this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position,
    })
    if (!result) return []
    return Array.isArray(result) ? result : result.items || []
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.sendNotification('exit')
      this.process.kill()
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill()
        }
      }, 5000)
    }
    this.pendingRequests.clear()
    this.initialized = false
  }
}
