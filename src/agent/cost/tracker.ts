/**
 * 费用追踪器 — 全局持久化，按 Provider/Model 聚合 Token 使用量
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getModelPricing } from './pricing'

export interface UsageRecord {
  timestamp: number
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
}

const USAGE_FILE = join(homedir(), '.note_agent', 'usage.json')

class CostTracker {
  private records: UsageRecord[] = []
  private loaded = false

  constructor() {
    this.load()
  }

  private ensureDir(): void {
    const dir = join(homedir(), '.note_agent')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  private load(): void {
    if (this.loaded) return
    this.ensureDir()
    try {
      if (existsSync(USAGE_FILE)) {
        const data = JSON.parse(readFileSync(USAGE_FILE, 'utf-8'))
        if (Array.isArray(data.records)) {
          this.records = data.records
        }
      }
    } catch {
      // ignore
    }
    this.loaded = true
  }

  private save(): void {
    this.ensureDir()
    try {
      writeFileSync(USAGE_FILE, JSON.stringify({ records: this.records }, null, 2), 'utf-8')
    } catch {
      // ignore
    }
  }

  record(provider: string, model: string, inputTokens: number, outputTokens: number): UsageRecord {
    const record: UsageRecord = {
      timestamp: Date.now(),
      provider,
      model,
      inputTokens,
      outputTokens,
    }
    this.records.push(record)
    this.save()
    return record
  }

  getTotalTokens(): { input: number; output: number } {
    return {
      input: this.records.reduce((sum, r) => sum + r.inputTokens, 0),
      output: this.records.reduce((sum, r) => sum + r.outputTokens, 0),
    }
  }

  getRecords(): UsageRecord[] {
    return [...this.records]
  }

  /**
   * 按 Provider + Model 聚合 Token 使用量
   */
  getTotalCost(): number {
    return 0 // Global tracker doesn't track cost, only tokens
  }

  generateReport(): string {
    const stats = this.getProviderStats()
    const total = this.getTotalTokens()
    if (stats.length === 0) return 'No usage recorded yet.'
    const lines = ['## Token Usage Report', '']
    lines.push('| Provider | Model | Input | Output | Calls |')
    lines.push('|----------|-------|-------|--------|-------|')
    for (const s of stats) {
      lines.push(`| ${s.provider} | ${s.model} | ${s.inputTokens.toLocaleString()} | ${s.outputTokens.toLocaleString()} | ${s.callCount} |`)
    }
    lines.push('')
    lines.push(`**Total Input:** ${total.input.toLocaleString()} tokens`)
    lines.push(`**Total Output:** ${total.output.toLocaleString()} tokens`)
    return lines.join('\n')
  }

  getProviderStats(): Array<{
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    callCount: number
  }> {
    const map = new Map<string, { inputTokens: number; outputTokens: number; callCount: number }>()
    for (const r of this.records) {
      const key = `${r.provider}:${r.model}`
      const existing = map.get(key)
      if (existing) {
        existing.inputTokens += r.inputTokens
        existing.outputTokens += r.outputTokens
        existing.callCount += 1
      } else {
        map.set(key, { inputTokens: r.inputTokens, outputTokens: r.outputTokens, callCount: 1 })
      }
    }
    return Array.from(map.entries())
      .map(([key, stats]) => {
        const [provider, model] = key.split(':')
        return {
          provider,
          model,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalTokens: stats.inputTokens + stats.outputTokens,
          callCount: stats.callCount,
        }
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)
  }

  clear(): void {
    this.records = []
    this.save()
  }
}

export const costTracker = new CostTracker()
