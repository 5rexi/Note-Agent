/**
 * FileHistory 工具 — 记录文件修改历史
 * 参考 design.md "FileHistory" 部分
 */
import { z } from 'zod'
import type { Tool, ToolContext, ToolResult } from '../Tool'

const inputSchema = z.object({
  path: z.string().describe('文件路径'),
})

export interface FileEditRecord {
  timestamp: number
  toolName: string
  toolCallId: string
  preview: string
}

const historyMap = new Map<string, FileEditRecord[]>()

export function recordFileEdit(filePath: string, record: FileEditRecord): void {
  const list = historyMap.get(filePath) || []
  list.push(record)
  historyMap.set(filePath, list)
}

export function getFileHistory(filePath: string): FileEditRecord[] {
  return historyMap.get(filePath) || []
}

export class FileHistoryTool implements Tool<z.infer<typeof inputSchema>, { history: FileEditRecord[] }> {
  readonly name = 'FileHistory'
  readonly description = '查看文件的修改历史记录'
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

  async call(input: z.infer<typeof inputSchema>): Promise<ToolResult<{ history: FileEditRecord[] }>> {
    const history = getFileHistory(input.path)
    return {
      data: { history },
    }
  }

  renderToolUse(input: z.infer<typeof inputSchema>): string {
    return `查看文件历史: ${input.path}`
  }

  renderToolResult(result: ToolResult<{ history: FileEditRecord[] }>): string {
    const data = result.data
    if (!data || data.history.length === 0) return '无修改记录'
    return data.history
      .map((h) => `[${new Date(h.timestamp).toISOString()}] ${h.toolName} (${h.toolCallId}): ${h.preview}`)
      .join('\n')
  }
}
