/**
 * Coordinator 模式 — 多 Agent 协调器
 * 参考设计文档第10章
 */
import type { Message, LLMConfig, PermissionMode } from '../types'
import { AgentEngine } from '../engine/AgentEngine'
import { hookRegistry } from '../hooks/types'

export interface WorkerConfig {
  name: string
  model?: string
  mode?: PermissionMode
  systemPrompt?: string
}

export interface CoordinatorOptions {
  llmConfig: LLMConfig
  workspacePath: string
  workers: WorkerConfig[]
}

export class Coordinator {
  private opts: CoordinatorOptions
  private workers = new Map<string, AgentEngine>()

  constructor(opts: CoordinatorOptions) {
    this.opts = opts
  }

  async initialize(): Promise<void> {
    for (const workerCfg of this.opts.workers) {
      const engine = new AgentEngine({
        llmConfig: {
          ...this.opts.llmConfig,
          model: workerCfg.model || this.opts.llmConfig.model,
        },
        workspacePath: this.opts.workspacePath,
        mode: workerCfg.mode || 'explore',
        tools: [],
      })
      this.workers.set(workerCfg.name, engine)
    }

    await hookRegistry.emit('CoordinatorInitialized', {
      workerCount: this.workers.size,
    })
  }

  async delegate(task: string, workerName: string): Promise<string> {
    const worker = this.workers.get(workerName)
    if (!worker) throw new Error(`Worker '${workerName}' not found`)

    const events: any[] = []
    for await (const event of worker.submit(task)) {
      events.push(event)
    }

    return events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join('')
  }

  async broadcast(task: string): Promise<Record<string, string>> {
    const results: Record<string, string> = {}
    const promises = Array.from(this.workers.entries()).map(async ([name, worker]) => {
      const events: any[] = []
      for await (const event of worker.submit(task)) {
        events.push(event)
      }
      results[name] = events
        .filter((e) => e.type === 'text')
        .map((e) => e.text)
        .join('')
    })
    await Promise.all(promises)
    return results
  }

  getWorkerNames(): string[] {
    return Array.from(this.workers.keys())
  }
}
