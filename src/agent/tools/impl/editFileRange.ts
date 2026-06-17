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
  expectedText: z.string().optional().describe('STRONGLY RECOMMENDED: the exact text you believe currently occupies the range. The edit is rejected (not applied) if it does not match — this catches column miscalculations before they corrupt the file. Line endings are matched leniently.'),
})

type Input = z.infer<typeof inputSchema>

export const EditFileRangeTool: Tool<Input, { path: string; replaced: boolean }> = {
  name: 'editFileRange',
  description:
    'Edit a file by replacing the text in a specific line:column range (1-based, endColumn EXCLUSIVE). ' +
    'Manual column math is error-prone — PREFER editFile (search/replace with a unique snippet) when possible. ' +
    'If you do use a range, ALWAYS pass `expectedText` (the exact current text in the range) so a miscalculated range is rejected instead of corrupting the file.',
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
    // Normalize CRLF to LF for editing, preserve original EOL style for output
    const originalHasCRLF = content.includes('\r\n')
    const normalizedContent = originalHasCRLF ? content.replace(/\r\n/g, '\n') : content
    const lines = normalizedContent.split('\n')

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

    // Verify the caller's column math against what is actually there. Catches
    // off-by-one range errors BEFORE they corrupt the file (the reported
    // "st.ructural" / "si.nal" corruption from miscalculated columns).
    if (input.expectedText !== undefined) {
      if (sCol > (lines[sLine]?.length ?? 0) || eCol > (lines[eLine]?.length ?? 0)) {
        return { data: { path: input.path, replaced: false }, error: `Range column out of bounds for verification on line ${startLine}/${endLine}.` }
      }
      const actual = sLine === eLine
        ? lines[sLine].slice(sCol, eCol)
        : [lines[sLine].slice(sCol), ...lines.slice(sLine + 1, eLine), lines[eLine].slice(0, eCol)].join('\n')
      const expected = input.expectedText.replace(/\r\n/g, '\n')
      if (actual !== expected) {
        return {
          data: { path: input.path, replaced: false },
          error:
            `Range verification FAILED — not applied. The text currently at ` +
            `L${startLine}:C${startColumn}–L${endLine}:C${endColumn} is:\n${JSON.stringify(actual.slice(0, 200))}\n` +
            `but expectedText was:\n${JSON.stringify(expected.slice(0, 200))}\n` +
            `Columns are 1-based and endColumn is EXCLUSIVE. Recheck the range, or use editFile with a unique search snippet instead.`,
        }
      }
    }

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

    // Restore original line endings if file used CRLF
    const finalContent = originalHasCRLF ? newContent.replace(/\n/g, '\r\n') : newContent
    writeFileSync(filePath, finalContent, 'utf-8')

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
