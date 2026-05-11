/**
 * StreamingToolExecutor — 流式响应中提前执行 Tool
 * 参考设计文档第06章
 *
 * 核心思想：API 还在流式返回时，已完全接收输入的 Tool 可以开始执行。
 * 这显著降低了多 Tool 调用的延迟。
 */
import type { Tool, ToolContext } from '../tools/Tool'
import type { ToolCall } from '../types'
import { executeSingleTool } from './tool-executor'
import type { PermissionContext } from '../tools/permissions'

export interface StreamingToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  completed: boolean
}

/**
 * 在流式响应中，当 tool_call 的输入完全接收后立即执行
 */
export async function executeStreamingTools(
  toolCalls: ToolCall[],
  tools: Tool[],
  ctx: ToolContext,
  permCtx: PermissionContext,
  onResult: (result: StreamingToolResult) => void,
): Promise<StreamingToolResult[]> {
  const results: StreamingToolResult[] = []

  // Partition by concurrency safety
  const safe: { tc: ToolCall; tool: Tool }[] = []
  const unsafe: { tc: ToolCall; tool: Tool }[] = []

  for (const tc of toolCalls) {
    const tool = tools.find((t) => t.name === tc.name || t.aliases?.includes(tc.name))
    if (!tool) {
      onResult({ toolCallId: tc.id, toolName: tc.name, result: { error: `Tool '${tc.name}' not found` }, completed: true })
      results.push({ toolCallId: tc.id, toolName: tc.name, result: { error: `Tool '${tc.name}' not found` }, completed: true })
      continue
    }
    if (tool.isConcurrencySafe()) {
      safe.push({ tc, tool })
    } else {
      unsafe.push({ tc, tool })
    }
  }

  // Execute safe ones in parallel
  const safePromises = safe.map(async ({ tc, tool }) => {
    const result = await executeSingleTool(tc, tool, ctx, permCtx)
    const str = { toolCallId: result.toolCallId, toolName: result.toolName, result: result.result, completed: true }
    onResult(str)
    results.push(str)
  })

  // Execute unsafe ones serially
  const unsafePromise = (async () => {
    for (const { tc, tool } of unsafe) {
      const result = await executeSingleTool(tc, tool, ctx, permCtx)
      const str = { toolCallId: result.toolCallId, toolName: result.toolName, result: result.result, completed: true }
      onResult(str)
      results.push(str)
    }
  })()

  await Promise.all([...safePromises, unsafePromise])
  return results
}

// Re-export from tool-executor for consumers expecting it from this module
export { executeSingleTool } from './tool-executor'
