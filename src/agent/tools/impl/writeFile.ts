import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { recordFileEdit } from './history'

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe('File content to write'),
})

type Input = z.infer<typeof inputSchema>

export const WriteFileTool: Tool<Input, { path: string; bytes: number }> = {
  name: 'writeFile',
  description: 'Create or overwrite a file in the workspace.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    // Warn about suspiciously short content (likely a placeholder)
    if (input.content.length < 20 && !input.path.includes('test') && !input.path.includes('temp')) {
      return {
        result: 'ask',
        description: `Write file: ${input.path} — Content is only ${input.content.length} bytes ("${input.content.slice(0, 40)}"). This looks like a placeholder. Continue?`,
      }
    }
    // ASK 模式需要确认
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Write file: ${input.path} (${input.content.length} bytes)`,
      }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow writing files' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; bytes: number }>> {
    const filePath = safePath(input.path, ctx.workspacePath)

    // Stale write protection for existing files
    if (existsSync(filePath)) {
      try {
        fileStateCache.assertUnchanged(filePath)
      } catch (err: any) {
        return { data: { path: input.path, bytes: 0 }, error: err.message }
      }
    }

    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, input.content, 'utf-8')

    // Notify renderer that file changed (so editor refreshes)
    try {
      const { notifyFileChanged } = require('../../../main/file-notify')
      notifyFileChanged(filePath)
    } catch {
      // ignore in test environment
    }

    // Record state after write
    fileStateCache.record(filePath)
    recordFileEdit(filePath, {
      timestamp: Date.now(),
      toolName: 'writeFile',
      toolCallId: '',
      preview: `wrote ${input.content.length} bytes`,
    })

    return { data: { path: input.path, bytes: input.content.length } }
  },

  renderToolUse(input) {
    return `Write file: ${input.path} (${input.content.length} bytes)`
  },
}
