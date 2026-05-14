import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'
import { XMLSerializer } from '@xmldom/xmldom'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  path: z.string().describe('Element path, e.g. /body/p[1] or /body/tbl[1]'),
  action: z.enum(['get', 'set']).describe('"get" to read raw XML, "set" to replace with new XML'),
  xml: z.string().optional().describe('New XML content (required for action="set"). Must be valid OOXML.'),
})

type Input = z.infer<typeof inputSchema>

export const WordRawTool: Tool<Input, { filePath: string; path: string; action: string; xml?: string }> = {
  name: 'wordRaw',
  description:
    'Low-level XML access to a Word document. Use this when wordSet/wordAdd cannot handle a specific case. ' +
    'action="get" returns the raw XML of the element at the given path. ' +
    'action="set" replaces the element with the provided XML string. ' +
    'WARNING: Invalid XML can corrupt the document. Always validate your XML.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Raw XML ${input.action} on ${input.path} in ${input.filePath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; path: string; action: string; xml?: string }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, path: input.path, action: input.action },
        error: error!.message,
      }
    }

    try {
      const resolved = resolvePath(doc, input.path)
      if (resolved.error || !resolved.element) {
        return {
          data: { filePath: input.filePath, path: input.path, action: input.action },
          error: resolved.error
            ? `[${resolved.error.code}] ${resolved.error.message}${resolved.error.suggestion ? '\nSuggestion: ' + resolved.error.suggestion : ''}`
            : `Element not found at ${input.path}`,
        }
      }

      if (input.action === 'get') {
        const serializer = new XMLSerializer()
        const xml = serializer.serializeToString(resolved.element)
        return {
          data: { filePath: input.filePath, path: input.path, action: 'get', xml },
          preview: `Raw XML of ${input.path}:\n${xml.slice(0, 500)}${xml.length > 500 ? '...' : ''}`,
        }
      }

      if (input.action === 'set') {
        if (!input.xml) {
          return {
            data: { filePath: input.filePath, path: input.path, action: 'set' },
            error: 'xml is required for action="set"',
          }
        }

        const parent = resolved.parent
        if (!parent) {
          return {
            data: { filePath: input.filePath, path: input.path, action: 'set' },
            error: 'Cannot replace root element',
          }
        }

        const parser = new (require('@xmldom/xmldom').DOMParser)()
        const wrapped = `<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${input.xml}</root>`
        const parsed = parser.parseFromString(wrapped, 'application/xml')
        const newEl = parsed.documentElement.firstChild as Element

        if (!newEl) {
          return {
            data: { filePath: input.filePath, path: input.path, action: 'set' },
            error: 'Failed to parse provided XML',
          }
        }

        // Import node into target document
        const imported = doc.document.importNode(newEl, true)
        parent.insertBefore(imported, resolved.element)
        parent.removeChild(resolved.element)

        doc.isDirty = true
        const saveResult = await saveDocx(doc)
        if (!saveResult.success) {
          return {
            data: { filePath: input.filePath, path: input.path, action: 'set' },
            error: saveResult.error?.message || 'Failed to save document',
          }
        }

        return {
          data: { filePath: input.filePath, path: input.path, action: 'set' },
          preview: `Replaced XML at ${input.path}`,
        }
      }

      return {
        data: { filePath: input.filePath, path: input.path, action: input.action },
        error: `Unknown action: ${input.action}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordRaw ${input.filePath} ${input.path} --action ${input.action}`
  },
}
