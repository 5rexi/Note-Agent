import { appendFileSync, existsSync } from 'fs'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { recordFileEdit } from './history'

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe('Content to append to the end of the file'),
})

type Input = z.infer<typeof inputSchema>

export const AppendFileTool: Tool<Input, { path: string; bytes: number }> = {
  name: 'appendFile',
  description:
    'Append content to the end of an existing file. This is the RIGHT tool for building long documents section by section. ' +
    'Unlike writeFile (which overwrites), appendFile ADDS to the existing content. ' +
    'Use this when generating long documents: writeFile the skeleton first, then appendFile each section.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Append to file: ${input.path} (${input.content.length} bytes)`,
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
    if (!existsSync(filePath)) {
      return { data: { path: input.path, bytes: 0 }, error: `File not found: ${input.path}. Use writeFile to create it first.` }
    }

    // Stale write protection
    try {
      fileStateCache.assertUnchanged(filePath)
    } catch (err: any) {
      return { data: { path: input.path, bytes: 0 }, error: err.message }
    }

    appendFileSync(filePath, input.content, 'utf-8')

    // Notify renderer
    try {
      const { notifyFileChanged } = require('../../../main/file-notify')
      notifyFileChanged(filePath)
    } catch {
      // ignore in test environment
    }

    fileStateCache.record(filePath)
    recordFileEdit(filePath, {
      timestamp: Date.now(),
      toolName: 'appendFile',
      toolCallId: '',
      preview: `appended ${input.content.length} bytes`,
    })

    return {
      data: { path: input.path, bytes: input.content.length },
      preview: `appended ${input.content.length} bytes to ${input.path}`,
    }
  },

  renderToolUse(input) {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''
    return `Append to file: ${path} (+${content.length} bytes)`
  },
}
