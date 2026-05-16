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
    // Defensive: input may be malformed/truncated from the LLM
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''
    // Warn about suspiciously short content (likely a placeholder)
    if (content.length < 20 && !path.includes('test') && !path.includes('temp')) {
      return {
        result: 'ask',
        description: `Write file: ${path} — Content is only ${content.length} bytes ("${content.slice(0, 40)}"). This looks like a placeholder. Continue?`,
      }
    }
    // ASK 模式需要确认
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Write file: ${path} (${content.length} bytes)`,
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
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''
    return `Write file: ${path} (${content.length} bytes)`
  },
}
