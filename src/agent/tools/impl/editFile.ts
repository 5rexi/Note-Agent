import { readFileSync, writeFileSync, existsSync } from 'fs'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { recordFileEdit } from './history'

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  search: z.string().describe('Text to find. Copy it VERBATIM from readFile output (including indentation); it must be unique in the file. Line endings are matched leniently (CRLF/LF agnostic).'),
  replace: z.string().describe('Replacement text'),
})

type Input = z.infer<typeof inputSchema>

export const EditFileTool: Tool<Input, { path: string; replacements: number }> = {
  name: 'editFile',
  description: 'Edit a file by replacing the `search` string with the `replace` string. Matching is line-ending agnostic (works on CRLF Windows files). Prefer this over editFileRange — copy a unique `search` snippet verbatim from readFile instead of computing line/column numbers.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Edit file: ${input.path}`,
      }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow editing files' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; replacements: number }>> {
    const filePath = safePath(input.path, ctx.workspacePath)
    if (!existsSync(filePath)) {
      return { data: { path: input.path, replacements: 0 }, error: `File not found: ${input.path}` }
    }

    // Stale write protection
    try {
      fileStateCache.assertUnchanged(filePath)
    } catch (err: any) {
      return { data: { path: input.path, replacements: 0 }, error: err.message }
    }

    const raw = readFileSync(filePath, 'utf-8')
    if (input.search === '') {
      return { data: { path: input.path, replacements: 0 }, error: `Search text cannot be empty` }
    }
    // Line-ending agnostic matching: normalize file + search/replace to LF for
    // the match, then write back in the file's original EOL style. This is the
    // fix for "search text not found" on CRLF (Windows) .tex/.md files.
    const hasCRLF = raw.includes('\r\n')
    const norm = (s: string) => s.replace(/\r\n/g, '\n')
    const content = norm(raw)
    const search = norm(input.search)
    const replace = norm(input.replace)
    if (!content.includes(search)) {
      return {
        data: { path: input.path, replacements: 0 },
        error: `Search text not found in ${input.path}. Matching ignores CRLF/LF differences, so copy the snippet VERBATIM from readFile output (exact characters + indentation) and make sure it is unique.`,
      }
    }
    const replacedNorm = content.split(search).join(replace)
    const replacements = content.split(search).length - 1
    const newContent = hasCRLF ? replacedNorm.replace(/\n/g, '\r\n') : replacedNorm
    writeFileSync(filePath, newContent, 'utf-8')

    // Notify renderer that file changed (so editor refreshes)
    try {
      const { notifyFileChanged } = require('../../../main/file-notify')
      notifyFileChanged(filePath)
    } catch {
      // ignore in test environment
    }

    // Record state after edit
    fileStateCache.record(filePath)
    recordFileEdit(filePath, {
      timestamp: Date.now(),
      toolName: 'editFile',
      toolCallId: '',
      preview: `replaced "${input.search.slice(0, 30)}" with "${input.replace.slice(0, 30)}"`,
    })

    return { data: { path: input.path, replacements } }
  },

  renderToolUse(input) {
    return `Edit file: ${input.path}`
  },
}
