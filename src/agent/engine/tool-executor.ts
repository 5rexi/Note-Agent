/**
 * Tool dispatch for the round executor.
 *
 * Splits incoming tool calls into concurrency-safe (run in parallel) and
 * unsafe (run serially) buckets, applies permission gating, runs the
 * actual tool, and trims oversized results via the budget helper.
 */
import type { LLMConfig, ToolCall, AgentEvent } from '../types'
import type { Tool, ToolContext } from '../tools/Tool'
import { applyBudget } from '../tools/budget'
import { checkToolPermission, type PermissionContext } from '../tools/permissions'

export interface ToolRunResult {
  toolCallId: string
  toolName: string
  result: unknown
}

export async function runTools(
  toolCalls: ToolCall[],
  tools: Tool[],
  ctx: ToolContext,
  permCtx: PermissionContext,
  onEvent?: (event: AgentEvent) => void,
  llmConfig?: LLMConfig,
): Promise<ToolRunResult[]> {
  const safe: { index: number; tc: ToolCall; tool: Tool }[] = []
  const unsafe: { index: number; tc: ToolCall; tool: Tool }[] = []

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    const tool = tools.find((t) => t.name === tc.name || t.aliases?.includes(tc.name))
    if (!tool) {
      unsafe.push({ index: i, tc, tool: null as any })
      continue
    }
    if (tool.isConcurrencySafe()) {
      safe.push({ index: i, tc, tool })
    } else {
      unsafe.push({ index: i, tc, tool })
    }
  }

  // Pre-allocate results so order matches toolCalls regardless of execution order.
  const results: ToolRunResult[] = new Array(toolCalls.length)

  const safePromises = safe.map(async ({ index, tc, tool }) => {
    const toolCtx: ToolContext = {
      ...ctx,
      ...(onEvent ? { reportEvent: onEvent } : {}),
      parentToolCallId: tc.id,
      ...(llmConfig ? { llmConfig } : {}),
    }
    results[index] = await executeSingleTool(tc, tool, toolCtx, permCtx)
  })
  await Promise.all(safePromises)

  for (const { index, tc, tool } of unsafe) {
    const toolCtx: ToolContext = {
      ...ctx,
      ...(onEvent ? { reportEvent: onEvent } : {}),
      parentToolCallId: tc.id,
      ...(llmConfig ? { llmConfig } : {}),
    }
    results[index] = await executeSingleTool(tc, tool, toolCtx, permCtx)
  }

  return results
}

export async function executeSingleTool(
  tc: ToolCall,
  tool: Tool,
  ctx: ToolContext,
  permCtx: PermissionContext,
): Promise<ToolRunResult> {
  if (!tool) {
    return { toolCallId: tc.id, toolName: tc.name, result: { error: `Tool '${tc.name}' not found` } }
  }

  try {
    const validated = tool.validateInput(tc.input)

    if (permCtx.approvedToolCallIds?.has(tc.id)) {
      const toolResult = await tool.call(validated, ctx)
      const budgeted = applyBudget(toolResult, tool.maxResultSizeChars, tc.id)
      return { toolCallId: tc.id, toolName: tc.name, result: budgeted }
    }

    if (permCtx.rejectedToolCallIds?.has(tc.id)) {
      return { toolCallId: tc.id, toolName: tc.name, result: { rejected: true, reason: 'User denied this operation' } }
    }

    const perm = checkToolPermission(tool, validated, permCtx)
    if (perm.result === 'deny') {
      return { toolCallId: tc.id, toolName: tc.name, result: { error: perm.reason } }
    }

    if (perm.result === 'ask') {
      return {
        toolCallId: tc.id,
        toolName: tc.name,
        result: {
          needsConfirmation: true,
          description: perm.description,
          plan: tool.renderToolUse?.(validated) || '',
        },
      }
    }

    const toolResult = await tool.call(validated, ctx)
    const budgeted = applyBudget(toolResult, tool.maxResultSizeChars, tc.id)
    return { toolCallId: tc.id, toolName: tc.name, result: budgeted }
  } catch (err: any) {
    return { toolCallId: tc.id, toolName: tc.name, result: { error: err.message } }
  }
}
