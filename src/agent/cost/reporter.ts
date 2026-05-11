/**
 * 费用报告生成器 — Markdown格式
 */
import { costTracker } from './tracker'

export function generateCostReport(): string {
  return costTracker.generateReport()
}

export function saveCostReport(path: string): void {
  const report = generateCostReport()
  Bun.write(path, report)
}
