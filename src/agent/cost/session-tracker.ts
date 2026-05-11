/**
 * Per-session cost tracker.
 *
 * Tracks token usage round-by-round for a single agent session, estimates
 * cost using shared pricing data from `./pricing`, and forwards every
 * record to the global `costTracker` so cross-session aggregates stay
 * consistent.
 */
import { getModelPricing, type ModelPricing } from './pricing'
import { costTracker as globalCostTracker } from './tracker'

export interface SessionUsageRecord {
  round: number
  inputTokens: number
  outputTokens: number
  timestamp: number
}

export interface CostEstimate {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  inputCost: number
  outputCost: number
  totalCost: number
  currency: string
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, '')
}

export class SessionCostTracker {
  private records: SessionUsageRecord[] = []
  private customPricing: Record<string, ModelPricing> = {}
  private currentModel = 'unknown'
  private currentProvider = 'unknown'

  setModel(model: string): void {
    this.currentModel = model
  }

  setProvider(provider: string): void {
    this.currentProvider = provider
  }

  setCustomPricing(pricing: Record<string, ModelPricing>): void {
    this.customPricing = pricing
  }

  addUsage(inputTokens: number, outputTokens: number): void {
    this.records.push({
      round: this.records.length + 1,
      inputTokens,
      outputTokens,
      timestamp: Date.now(),
    })
    globalCostTracker.record(this.currentProvider, this.currentModel, inputTokens, outputTokens)
  }

  getPricing(model?: string): ModelPricing {
    const target = model ?? this.currentModel
    const normalized = normalize(target)
    for (const [key, val] of Object.entries(this.customPricing)) {
      if (normalize(key) === normalized) return val
    }
    return getModelPricing(target)
  }

  getEstimate(): CostEstimate {
    const totalInput = this.records.reduce((sum, r) => sum + r.inputTokens, 0)
    const totalOutput = this.records.reduce((sum, r) => sum + r.outputTokens, 0)
    const pricing = this.getPricing()

    const inputCost = (totalInput / 1_000_000) * pricing.inputPricePer1M
    const outputCost = (totalOutput / 1_000_000) * pricing.outputPricePer1M

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
      currency: 'USD',
    }
  }

  getRecords(): SessionUsageRecord[] {
    return [...this.records]
  }

  clear(): void {
    this.records = []
  }

  formatReport(): string {
    if (this.records.length === 0) return 'No usage recorded yet.'

    const estimate = this.getEstimate()
    const pricing = this.getPricing()

    const lines: string[] = [
      '## Cost Report',
      `Model: ${this.currentModel}`,
      `Pricing: $${pricing.inputPricePer1M}/1M input, $${pricing.outputPricePer1M}/1M output`,
      '',
      '| Round | Input | Output | Total |',
      '|-------|-------|--------|-------|',
    ]

    for (const r of this.records) {
      lines.push(`| ${r.round} | ${r.inputTokens.toLocaleString()} | ${r.outputTokens.toLocaleString()} | ${(r.inputTokens + r.outputTokens).toLocaleString()} |`)
    }

    lines.push(
      '',
      `**Total Input:** ${estimate.totalInputTokens.toLocaleString()} tokens`,
      `**Total Output:** ${estimate.totalOutputTokens.toLocaleString()} tokens`,
      `**Total Tokens:** ${estimate.totalTokens.toLocaleString()}`,
      `**Input Cost:** $${estimate.inputCost.toFixed(6)}`,
      `**Output Cost:** $${estimate.outputCost.toFixed(6)}`,
      `**Total Cost:** $${estimate.totalCost.toFixed(6)} ${estimate.currency}`,
    )

    return lines.join('\n')
  }
}

/** @deprecated Use `SessionCostTracker`. Kept as alias for migration. */
export const CostTracker = SessionCostTracker
export type UsageRecord = SessionUsageRecord
