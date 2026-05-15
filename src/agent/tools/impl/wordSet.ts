import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'

const propSchema = z.record(z.string(), z.any()).describe(
  'Properties to set. Examples: { text: "New content" }, { bold: true, color: "FF0000" }, { alignment: "center" }, { headingLevel: 2 }'
)

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  path: z.string().describe('Element path, e.g. /body/p[1]/r[1] for a run, /body/p[1] for a paragraph'),
  props: propSchema,
})

type Input = z.infer<typeof inputSchema>

export const WordSetTool: Tool<Input, { filePath: string; path: string; props: Record<string, any> }> = {
  name: 'wordSet',
  description:
    'Set properties on an element at a specific path in a Word document. ' +
    'Use wordQuery to find the correct path first. ' +
    'Supported props depend on element type:\n' +
    '- On a run (/body/p[N]/r[M]): text, bold, italic, superscript, subscript, fontSize (half-points), color (hex)\n' +
    '- On a paragraph (/body/p[N]): alignment (left/center/right/justify), headingLevel (1-6), spacingAfter (twips), indentation ({left, right, firstLine})\n' +
    '- On any element: style (paragraph style name)',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    const desc = Object.entries(input.props).map(([k, v]) => `${k}=${v}`).join(', ')
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Set ${desc} on ${input.path} in ${input.filePath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; path: string; props: Record<string, any> }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, path: input.path, props: input.props },
        error: error!.message,
      }
    }

    try {
      const resolved = resolvePath(doc, input.path)
      if (resolved.error || !resolved.element) {
        return {
          data: { filePath: input.filePath, path: input.path, props: input.props },
          error: resolved.error
            ? `[${resolved.error.code}] ${resolved.error.message}${resolved.error.suggestion ? '\nSuggestion: ' + resolved.error.suggestion : ''}`
            : `Element not found at ${input.path}`,
        }
      }

      const el = resolved.element
      const docEl = doc.document
      const applied: string[] = []
      const failed: string[] = []

      for (const [key, value] of Object.entries(input.props)) {
        try {
          const success = applyProperty(el, key, value, docEl)
          if (success) {
            applied.push(key)
          } else {
            failed.push(key)
          }
        } catch (e: any) {
          failed.push(`${key}: ${e.message}`)
        }
      }

      if (applied.length > 0) {
        doc.isDirty = true
        // Save undo history
        const originalBuffer = Buffer.from(docEl as any)
        const db = (global as any).__db as { pushFileHistory?: (path: string, content: string) => void } | undefined
        if (db?.pushFileHistory) {
          db.pushFileHistory(input.filePath, originalBuffer.toString('base64'))
        }

        const saveResult = await saveDocx(doc)
        if (!saveResult.success) {
          return {
            data: { filePath: input.filePath, path: input.path, props: input.props },
            error: saveResult.error?.message || 'Failed to save document',
          }
        }
      }

      return {
        data: { filePath: input.filePath, path: input.path, props: input.props },
        preview: `Set ${applied.join(', ')} on ${input.path}${failed.length > 0 ? '\nFailed: ' + failed.join(', ') : ''}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    const props = Object.entries(input.props).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    return `wordSet ${input.filePath} ${input.path} --prop ${props}`
  },
}

// ── Property Application ──

function applyProperty(el: Element, key: string, value: any, doc: Document): boolean {
  const tag = el.tagName

  switch (key) {
    case 'text': {
      // For w:r: replace w:t content
      // For w:p: replace all runs with a single run containing the new text
      if (tag === 'w:r') {
        const t = el.getElementsByTagName('w:t')[0]
        if (t) {
          t.textContent = String(value)
          if (/^\s+|\s+$/.test(String(value))) {
            t.setAttribute('xml:space', 'preserve')
          }
        } else {
          const newT = doc.createElement('w:t')
          newT.textContent = String(value)
          if (/^\s+|\s+$/.test(String(value))) {
            newT.setAttribute('xml:space', 'preserve')
          }
          el.appendChild(newT)
        }
        return true
      }
      if (tag === 'w:p') {
        // Clear all runs, keep pPr, add new single run
        const pPr = el.getElementsByTagName('w:pPr')[0]
        while (el.firstChild) el.removeChild(el.firstChild)
        if (pPr) el.appendChild(pPr)
        const newRun = doc.createElement('w:r')
        const newT = doc.createElement('w:t')
        newT.textContent = String(value)
        if (/^\s+|\s+$/.test(String(value))) {
          newT.setAttribute('xml:space', 'preserve')
        }
        newRun.appendChild(newT)
        el.appendChild(newRun)
        return true
      }
      return false
    }

    case 'bold': {
      const rPr = ensureRPr(el, doc)
      if (value) {
        const b = getOrCreateChild(rPr, 'w:b', doc)
        b.setAttribute('w:val', '1')
      } else {
        removeChildIfExists(rPr, 'w:b')
      }
      return true
    }

    case 'italic': {
      const rPr = ensureRPr(el, doc)
      if (value) {
        const i = getOrCreateChild(rPr, 'w:i', doc)
        i.setAttribute('w:val', '1')
      } else {
        removeChildIfExists(rPr, 'w:i')
      }
      return true
    }

    case 'fontSize': {
      const rPr = ensureRPr(el, doc)
      const val = String(value)
      getOrCreateChild(rPr, 'w:sz', doc).setAttribute('w:val', val)
      getOrCreateChild(rPr, 'w:szCs', doc).setAttribute('w:val', val)
      return true
    }

    case 'color': {
      const rPr = ensureRPr(el, doc)
      const hex = String(value).replace(/^#/, '')
      getOrCreateChild(rPr, 'w:color', doc).setAttribute('w:val', hex)
      return true
    }

    case 'superscript': {
      const rPr = ensureRPr(el, doc)
      if (value) {
        const va = getOrCreateChild(rPr, 'w:vertAlign', doc)
        va.setAttribute('w:val', 'superscript')
      } else {
        removeChildIfExists(rPr, 'w:vertAlign')
      }
      return true
    }

    case 'subscript': {
      const rPr = ensureRPr(el, doc)
      if (value) {
        const va = getOrCreateChild(rPr, 'w:vertAlign', doc)
        va.setAttribute('w:val', 'subscript')
      } else {
        removeChildIfExists(rPr, 'w:vertAlign')
      }
      return true
    }

    case 'alignment': {
      if (tag !== 'w:p') return false
      const pPr = ensurePPr(el, doc)
      getOrCreateChild(pPr, 'w:jc', doc).setAttribute('w:val', String(value))
      return true
    }

    case 'headingLevel': {
      if (tag !== 'w:p') return false
      const pPr = ensurePPr(el, doc)
      const level = Math.max(1, Math.min(6, Number(value)))
      getOrCreateChild(pPr, 'w:pStyle', doc).setAttribute('w:val', `Heading${level}`)
      return true
    }

    case 'spacingAfter': {
      if (tag !== 'w:p') return false
      const pPr = ensurePPr(el, doc)
      const sp = getOrCreateChild(pPr, 'w:spacing', doc)
      sp.setAttribute('w:after', String(value))
      return true
    }

    case 'indentation': {
      if (tag !== 'w:p') return false
      const pPr = ensurePPr(el, doc)
      const ind = getOrCreateChild(pPr, 'w:ind', doc)
      const v = value as Record<string, number>
      if (v.left !== undefined) ind.setAttribute('w:left', String(v.left))
      if (v.right !== undefined) ind.setAttribute('w:right', String(v.right))
      if (v.firstLine !== undefined) ind.setAttribute('w:firstLine', String(v.firstLine))
      return true
    }

    case 'style': {
      if (tag !== 'w:p') return false
      const pPr = ensurePPr(el, doc)
      getOrCreateChild(pPr, 'w:pStyle', doc).setAttribute('w:val', String(value))
      return true
    }

    default:
      return false
  }
}

function ensureRPr(el: Element, doc: Document): Element {
  if (el.tagName === 'w:r') {
    let rPr = el.getElementsByTagName('w:rPr')[0]
    if (!rPr) {
      rPr = doc.createElement('w:rPr')
      el.insertBefore(rPr, el.firstChild)
    }
    return rPr
  }
  // For paragraph-level, we need to create/modify a run's rPr or the default rPr in pPr
  // For simplicity, create a new run with rPr if none exist
  let rPr = el.getElementsByTagName('w:rPr')[0]
  if (!rPr) {
    rPr = doc.createElement('w:rPr')
    // If element is a paragraph, we can't attach rPr directly. Find/create first run.
    if (el.tagName === 'w:p') {
      let run = el.getElementsByTagName('w:r')[0]
      if (!run) {
        run = doc.createElement('w:r')
        el.appendChild(run)
      }
      run.insertBefore(rPr, run.firstChild)
    } else {
      el.insertBefore(rPr, el.firstChild)
    }
  }
  return rPr
}

function ensurePPr(el: Element, doc: Document): Element {
  let pPr = el.getElementsByTagName('w:pPr')[0]
  if (!pPr) {
    pPr = doc.createElement('w:pPr')
    el.insertBefore(pPr, el.firstChild)
  }
  return pPr
}

function getOrCreateChild(parent: Element, tagName: string, doc: Document): Element {
  let el = parent.getElementsByTagName(tagName)[0]
  if (!el) {
    el = doc.createElement(tagName)
    parent.appendChild(el)
  }
  return el
}

function removeChildIfExists(parent: Element, tagName: string): void {
  const existing = parent.getElementsByTagName(tagName)[0]
  if (existing) {
    parent.removeChild(existing)
  }
}
