/**
 * wordBatchSet — Batch modification of Word document elements.
 *
 * Opens the document once, applies all operations, saves once.
 * Dramatically reduces tool-call overhead for repetitive edits
 * (e.g. setting 86 citation superscripts).
 */

import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'
import { applyProperty } from './wordSet'

const operationSchema = z.object({
  path: z.string().describe('Element path, e.g. /body/p[1]/r[1]'),
  props: z.record(z.string(), z.any()).describe(
    'Properties to set. Same as wordSet: text, bold, italic, superscript, subscript, fontSize, color, alignment, headingLevel, etc.'
  ),
})

const inputSchema = z.object({
  filePath: z.string().describe('Path to the .docx file (relative to workspace or absolute)'),
  operations: z.array(operationSchema).min(1).max(100).describe(
    'Array of operations to apply. Each operation has a path and props. ' +
    'Max 100 operations per call to avoid timeouts.'
  ),
})

type Input = z.infer<typeof inputSchema>

export const WordBatchSetTool: Tool<Input, { filePath: string; applied: number; failed: number; details: string[] }> = {
  name: 'wordBatchSet',
  description:
    'Batch-set properties on multiple elements in a Word document with a single call. ' +
    'MUCH more efficient than calling wordSet repeatedly — use this for any bulk formatting task. ' +
    'Examples: make all citations superscript, change all heading colors, bulk font-size changes. ' +
    'Use wordView text mode to discover run paths and their current formatting.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    const count = input.operations.length
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Batch modify ${count} elements in ${input.filePath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; applied: number; failed: number; details: string[] }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, applied: 0, failed: input.operations.length, details: [] },
        error: error!.message,
      }
    }

    const details: string[] = []
    let totalApplied = 0
    let totalFailed = 0
    const docEl = doc.document

    try {
      for (const op of input.operations) {
        const resolved = resolvePath(doc, op.path)
        if (resolved.error || !resolved.element) {
          totalFailed++
          details.push(`[FAIL] ${op.path}: ${resolved.error?.message || 'not found'}`)
          continue
        }

        const el = resolved.element
        const appliedKeys: string[] = []
        const failedKeys: string[] = []

        for (const [key, value] of Object.entries(op.props)) {
          try {
            const success = applyProperty(el, key, value, docEl)
            if (success) {
              appliedKeys.push(key)
            } else {
              failedKeys.push(key)
            }
          } catch (e: any) {
            failedKeys.push(`${key}: ${e.message}`)
          }
        }

        if (appliedKeys.length > 0) {
          totalApplied++
          doc.isDirty = true
          details.push(`[OK] ${op.path}: ${appliedKeys.join(', ')}`)
        }
        if (failedKeys.length > 0) {
          totalFailed++
          details.push(`[FAIL] ${op.path}: ${failedKeys.join(', ')}`)
        }
      }

      if (doc.isDirty) {
        // Save undo history
        const serializer = new (require('@xmldom/xmldom').XMLSerializer)()
        const xmlStr = serializer.serializeToString(docEl)
        const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
        if (db?.pushFileHistory) {
          db.pushFileHistory(input.filePath, Buffer.from(xmlStr).toString('base64'))
        }

        const saveResult = await saveDocx(doc)
        if (!saveResult.success) {
          return {
            data: { filePath: input.filePath, applied: totalApplied, failed: totalFailed, details },
            error: saveResult.error?.message || 'Failed to save document',
          }
        }
      }

      return {
        data: { filePath: input.filePath, applied: totalApplied, failed: totalFailed, details },
        preview: `Batch set: ${totalApplied} succeeded, ${totalFailed} failed\n` + details.slice(0, 10).join('\n') + (details.length > 10 ? `\n... (${details.length - 10} more)` : ''),
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordBatchSet ${input.filePath} (${input.operations.length} ops)`
  },
}
