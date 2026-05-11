/**
 * Session-level cost tracker tests.
 */
import { describe, it, expect } from 'bun:test'
import { SessionCostTracker } from './session-tracker'

describe('SessionCostTracker', () => {
  it('should start empty', () => {
    const tracker = new SessionCostTracker()
    expect(tracker.getRecords().length).toBe(0)
    expect(tracker.getEstimate().totalTokens).toBe(0)
  })

  it('should add usage records', () => {
    const tracker = new SessionCostTracker()
    tracker.addUsage(1000, 500)
    tracker.addUsage(2000, 1000)

    const records = tracker.getRecords()
    expect(records.length).toBe(2)
    expect(records[0].inputTokens).toBe(1000)
    expect(records[0].outputTokens).toBe(500)
  })

  it('should calculate totals', () => {
    const tracker = new SessionCostTracker()
    tracker.addUsage(1000, 500)
    tracker.addUsage(2000, 1000)

    const estimate = tracker.getEstimate()
    expect(estimate.totalInputTokens).toBe(3000)
    expect(estimate.totalOutputTokens).toBe(1500)
    expect(estimate.totalTokens).toBe(4500)
  })

  it('should estimate cost for gpt-4o-mini using shared pricing table', () => {
    const tracker = new SessionCostTracker()
    tracker.setModel('gpt-4o-mini')
    tracker.addUsage(1_000_000, 1_000_000)

    const estimate = tracker.getEstimate()
    expect(estimate.inputCost).toBe(0.15)
    expect(estimate.outputCost).toBe(0.6)
    expect(estimate.totalCost).toBe(0.75)
  })

  it('should resolve pricing for gpt-4o from shared pricing table', () => {
    const tracker = new SessionCostTracker()
    tracker.setModel('gpt-4o')
    tracker.addUsage(1_000_000, 1_000_000)

    const estimate = tracker.getEstimate()
    expect(estimate.inputCost).toBe(5)
    expect(estimate.outputCost).toBe(15)
    expect(estimate.totalCost).toBe(20)
  })

  it('should handle unknown model with zero pricing', () => {
    const tracker = new SessionCostTracker()
    tracker.setModel('unknown-model')
    tracker.addUsage(1_000_000, 1_000_000)

    const estimate = tracker.getEstimate()
    expect(estimate.totalCost).toBe(0)
  })

  it('should support custom pricing', () => {
    const tracker = new SessionCostTracker()
    tracker.setModel('custom')
    tracker.setCustomPricing({ custom: { inputPricePer1M: 1, outputPricePer1M: 2 } })
    tracker.addUsage(1_000_000, 1_000_000)

    const estimate = tracker.getEstimate()
    expect(estimate.inputCost).toBe(1)
    expect(estimate.outputCost).toBe(2)
    expect(estimate.totalCost).toBe(3)
  })

  it('should format report', () => {
    const tracker = new SessionCostTracker()
    tracker.setModel('gpt-4o-mini')
    tracker.addUsage(1000, 500)

    const report = tracker.formatReport()
    expect(report).toContain('Cost Report')
    expect(report).toContain('gpt-4o-mini')
    expect(report).toContain('1,000')
    expect(report).toContain('Total Cost')
  })

  it('should handle empty report', () => {
    const tracker = new SessionCostTracker()
    const report = tracker.formatReport()
    expect(report).toBe('No usage recorded yet.')
  })

  it('should clear records', () => {
    const tracker = new SessionCostTracker()
    tracker.addUsage(100, 50)
    tracker.clear()
    expect(tracker.getRecords().length).toBe(0)
  })
})
