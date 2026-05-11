/**
 * CostTool — 费用查询和报告工具
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../tools/Tool'
import { costTracker, generateCostReport } from './index'

const inputSchema = z.object({
  action: z.enum(['report', 'summary', 'clear']).default('summary'),
})

export class CostTool implements Tool<z.infer<typeof inputSchema>, unknown> {
  readonly name = 'Cost'
  readonly description = '查询费用使用情况或生成报告'
  readonly inputSchema = inputSchema

  isReadOnly(): boolean { return true }
  isConcurrencySafe(): boolean { return true }
  isDestructive(): boolean { return false }

  checkPermissions(): { result: 'allow' } {
    return { result: 'allow' }
  }

  validateInput(raw: unknown): z.infer<typeof inputSchema> {
    return this.inputSchema.parse(raw)
  }

  async call(input: z.infer<typeof inputSchema>): Promise<ToolResult<unknown>> {
    if (input.action === 'clear') {
      costTracker.clear()
      return { data: { cleared: true } }
    }

    if (input.action === 'report') {
      return { data: { report: generateCostReport() } }
    }

    const tokens = costTracker.getTotalTokens()
    const cost = costTracker.getTotalCost()
    return {
      data: {
        totalInputTokens: tokens.input,
        totalOutputTokens: tokens.output,
        totalCost: cost,
        recordCount: costTracker.getRecords().length,
      },
    }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `费用${input.action === 'report' ? '报告' : input.action === 'clear' ? '清零' : '摘要'}`
  }
}
