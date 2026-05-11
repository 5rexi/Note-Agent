import { readFileSync, writeFileSync, existsSync } from 'fs'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { recordFileEdit } from './history'

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  startLine: z.number().int().min(1).describe('Start line number (1-based)'),
  startColumn: z.number().int().min(1).describe('Start column number (1-based)'),
  endLine: z.number().int().min(1).describe('End line number (1-based)'),
  endColumn: z.number().int().min(1).describe('End column number (1-based, exclusive)'),
  replacement: z.string().describe('Replacement text'),
})

type Input = z.infer<typeof inputSchema>

export const EditFileRangeTool: Tool<Input, { path: string; replaced: boolean }> = {
  name: 'editFileRange',
  description:
    'Edit a file by replacing the text in a specific line:column range. ' +
    'Line and column numbers are 1-based. The endColumn is exclusive. ' +
    'Use this when you need to make a precise edit at a known location, ' +
    'such as when the user has quoted a specific code selection.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Edit file range: ${input.path} (L${input.startLine}:C${input.startColumn} — L${input.endLine}:C${input.endColumn})`,
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

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; replaced: boolean }>> {
    const filePath = safePath(input.path, ctx.workspacePath)
    if (!existsSync(filePath)) {
      return { data: { path: input.path, replaced: false }, error: `File not found: ${input.path}` }
    }

    // Stale write protection
    try {
      fileStateCache.assertUnchanged(filePath)
    } catch (err: any) {
      return { data: { path: input.path, replaced: false }, error: err.message }
    }

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    const { startLine, startColumn, endLine, endColumn, replacement } = input

    // Validate range
    if (startLine > lines.length) {
      return { data: { path: input.path, replaced: false }, error: `Start line ${startLine} exceeds file length (${lines.length})` }
    }
    if (endLine > lines.length) {
      return { data: { path: input.path, replaced: false }, error: `End line ${endLine} exceeds file length (${lines.length})` }
    }
    if (startLine > endLine || (startLine === endLine && startColumn > endColumn)) {
      return { data: { path: input.path, replaced: false }, error: 'Invalid range: start position is after end position' }
    }

    // Convert 1-based to 0-based indices
    const sLine = startLine - 1
    const sCol = startColumn - 1
    const eLine = endLine - 1
    const eCol = endColumn - 1

    let newContent: string

    if (sLine === eLine) {
      // Single-line replacement
      const line = lines[sLine]
      if (sCol > line.length || eCol > line.length) {
        return { data: { path: input.path, replaced: false }, error: `Column out of bounds on line ${startLine}` }
      }
      const before = line.slice(0, sCol)
      const after = line.slice(eCol)
      lines[sLine] = before + replacement + after
      newContent = lines.join('\n')
    } else {
      // Multi-line replacement
      const startLineText = lines[sLine]
      const endLineText = lines[eLine]
      if (sCol > startLineText.length) {
        return { data: { path: input.path, replaced: false }, error: `Start column out of bounds on line ${startLine}` }
      }
      if (eCol > endLineText.length) {
        return { data: { path: input.path, replaced: false }, error: `End column out of bounds on line ${endLine}` }
      }
      const before = startLineText.slice(0, sCol)
      const after = endLineText.slice(eCol)
      const newLine = before + replacement + after
      // Replace [sLine, eLine] with newLine
      lines.splice(sLine, eLine - sLine + 1, newLine)
      newContent = lines.join('\n')
    }

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
      toolName: 'editFileRange',
      toolCallId: '',
      preview: `replaced range L${startLine}:C${startColumn} — L${endLine}:C${endColumn} in ${filePath}`,
    })

    return { data: { path: input.path, replaced: true } }
  },

  renderToolUse(input) {
    return `Edit file range: ${input.path} (L${input.startLine}:C${input.startColumn} — L${input.endLine}:C${input.endColumn})`
  },
}
