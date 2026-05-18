import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'
import { convertLatexToOmml } from './latex-to-math'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx file'),
  parentPath: z.string().describe('Parent element path where the new element will be inserted, e.g. /body or /body/p[1]'),
  type: z.enum(['paragraph', 'run', 'table', 'tableRow', 'tableCell', 'text']).describe('Type of element to add'),
  index: z.number().optional().describe('1-based index to insert at within parent (default: append at end)'),
  props: z.record(z.string(), z.any()).optional().describe(
    'Properties for the new element. Examples:\n' +
    '  { text: "Hello" } for paragraph/run\n' +
    '  { text: "Hello", bold: true, color: "FF0000" } for run\n' +
    '  { alignment: "center", headingLevel: 2 } for paragraph'
  ),
})

type Input = z.infer<typeof inputSchema>

export const WordAddTool: Tool<Input, { filePath: string; parentPath: string; type: string }> = {
  name: 'wordAdd',
  description:
    'Add a new element to a Word document at a specific parent path. ' +
    'Use wordQuery to find the correct parent path first. ' +
    'For adding a paragraph at the end of the document, use parentPath="/body".',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Add ${input.type} to ${input.parentPath} in ${input.filePath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; parentPath: string; type: string }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return {
        data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
        error: error!.message,
      }
    }

    try {
      const resolved = resolvePath(doc, input.parentPath)
      if (resolved.error || !resolved.element) {
        return {
          data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
          error: resolved.error
            ? `[${resolved.error.code}] ${resolved.error.message}${resolved.error.suggestion ? '\nSuggestion: ' + resolved.error.suggestion : ''}`
            : `Parent not found at ${input.parentPath}`,
        }
      }

      const parent = resolved.element
      const docEl = doc.document
      const props = input.props || {}
      const insertIndex = input.index !== undefined ? Math.max(0, input.index - 1) : -1

      let newEl: Element

      switch (input.type as string) {
        case 'paragraph': {
          newEl = docEl.createElementNS(WORD_NS, 'w:p')
          const pPr = docEl.createElementNS(WORD_NS, 'w:pPr')
          if (props.alignment) {
            const jc = docEl.createElementNS(WORD_NS, 'w:jc')
            jc.setAttribute('w:val', String(props.alignment))
            pPr.appendChild(jc)
          }
          if (props.headingLevel) {
            const level = Math.max(1, Math.min(6, Number(props.headingLevel)))
            const style = docEl.createElementNS(WORD_NS, 'w:pStyle')
            style.setAttribute('w:val', `Heading${level}`)
            pPr.appendChild(style)
          }
          if (props.style) {
            const style = docEl.createElementNS(WORD_NS, 'w:pStyle')
            style.setAttribute('w:val', String(props.style))
            pPr.appendChild(style)
          }
          if (pPr.childNodes.length > 0) newEl.appendChild(pPr)

          if (props.text !== undefined) {
            const run = docEl.createElementNS(WORD_NS, 'w:r')
            const t = docEl.createElementNS(WORD_NS, 'w:t')
            t.textContent = String(props.text)
            if (/^\s+|\s+$/.test(String(props.text))) {
              t.setAttribute('xml:space', 'preserve')
            }
            run.appendChild(t)
            newEl.appendChild(run)
          }
          break
        }

        case 'run': {
          newEl = docEl.createElementNS(WORD_NS, 'w:r')
          const rPr = docEl.createElementNS(WORD_NS, 'w:rPr')
          if (props.bold) {
            const b = docEl.createElementNS(WORD_NS, 'w:b')
            b.setAttribute('w:val', '1')
            rPr.appendChild(b)
          }
          if (props.italic) {
            const i = docEl.createElementNS(WORD_NS, 'w:i')
            i.setAttribute('w:val', '1')
            rPr.appendChild(i)
          }
          if (props.fontSize) {
            const sz = docEl.createElementNS(WORD_NS, 'w:sz')
            sz.setAttribute('w:val', String(props.fontSize))
            rPr.appendChild(sz)
          }
          if (props.color) {
            const color = docEl.createElementNS(WORD_NS, 'w:color')
            color.setAttribute('w:val', String(props.color).replace(/^#/, ''))
            rPr.appendChild(color)
          }
          if (props.superscript) {
            const va = docEl.createElementNS(WORD_NS, 'w:vertAlign')
            va.setAttribute('w:val', 'superscript')
            rPr.appendChild(va)
          }
          if (props.subscript) {
            const va = docEl.createElementNS(WORD_NS, 'w:vertAlign')
            va.setAttribute('w:val', 'subscript')
            rPr.appendChild(va)
          }
          if (rPr.childNodes.length > 0) newEl.appendChild(rPr)

          const t = docEl.createElementNS(WORD_NS, 'w:t')
          t.textContent = String(props.text ?? '')
          if (/^\s+|\s+$/.test(String(props.text ?? ''))) {
            t.setAttribute('xml:space', 'preserve')
          }
          newEl.appendChild(t)
          break
        }

        case 'table': {
          newEl = docEl.createElementNS(WORD_NS, 'w:tbl')
          const tblPr = docEl.createElementNS(WORD_NS, 'w:tblPr')

          // Table width
          const tblW = docEl.createElementNS(WORD_NS, 'w:tblW')
          tblW.setAttribute('w:w', '5000')
          tblW.setAttribute('w:type', 'pct')
          tblPr.appendChild(tblW)

          // Column widths
          if (props.columnWidths && Array.isArray(props.columnWidths)) {
            const tblGrid = docEl.createElementNS(WORD_NS, 'w:tblGrid')
            for (const cw of props.columnWidths) {
              const gridCol = docEl.createElementNS(WORD_NS, 'w:gridCol')
              gridCol.setAttribute('w:w', String(cw))
              tblGrid.appendChild(gridCol)
            }
            newEl.appendChild(tblGrid)
          }

          // Borders
          if (props.borders) {
            const tblBorders = docEl.createElementNS(WORD_NS, 'w:tblBorders')
            for (const [side, cfg] of Object.entries(props.borders)) {
              const borderEl = docEl.createElementNS(WORD_NS, `w:${side}`)
              const b = cfg as Record<string, string>
              if (b.style) borderEl.setAttribute('w:val', b.style)
              if (b.size) borderEl.setAttribute('w:sz', String(b.size))
              if (b.color) borderEl.setAttribute('w:color', String(b.color).replace(/^#/, ''))
              tblBorders.appendChild(borderEl)
            }
            tblPr.appendChild(tblBorders)
          }

          // Alignment
          if (props.alignment) {
            const jc = docEl.createElementNS(WORD_NS, 'w:jc')
            jc.setAttribute('w:val', String(props.alignment))
            tblPr.appendChild(jc)
          }

          newEl.appendChild(tblPr)
          break
        }

        case 'tableRow': {
          newEl = docEl.createElementNS(WORD_NS, 'w:tr')
          break
        }

        case 'tableCell': {
          newEl = docEl.createElementNS(WORD_NS, 'w:tc')
          const tcPr = docEl.createElementNS(WORD_NS, 'w:tcPr')

          // Cell width
          if (props.width) {
            const tcW = docEl.createElementNS(WORD_NS, 'w:tcW')
            tcW.setAttribute('w:w', String(props.width))
            tcW.setAttribute('w:type', props.widthType || 'dxa')
            tcPr.appendChild(tcW)
          }

          // Column span (merge cells horizontally)
          if (props.gridSpan) {
            const gs = docEl.createElementNS(WORD_NS, 'w:gridSpan')
            gs.setAttribute('w:val', String(props.gridSpan))
            tcPr.appendChild(gs)
          }

          // Row span (merge cells vertically)
          if (props.vMerge) {
            const vm = docEl.createElementNS(WORD_NS, 'w:vMerge')
            vm.setAttribute('w:val', String(props.vMerge)) // 'restart' or 'continue'
            tcPr.appendChild(vm)
          }

          // Shading (background color)
          if (props.shading) {
            const shd = docEl.createElementNS(WORD_NS, 'w:shd')
            shd.setAttribute('w:val', 'clear')
            shd.setAttribute('w:color', 'auto')
            shd.setAttribute('w:fill', String(props.shading).replace(/^#/, ''))
            tcPr.appendChild(shd)
          }

          // Cell borders
          if (props.borders) {
            const tcBorders = docEl.createElementNS(WORD_NS, 'w:tcBorders')
            for (const [side, cfg] of Object.entries(props.borders)) {
              const borderEl = docEl.createElementNS(WORD_NS, `w:${side}`)
              const b = cfg as Record<string, string>
              if (b.style) borderEl.setAttribute('w:val', b.style)
              if (b.size) borderEl.setAttribute('w:sz', String(b.size))
              if (b.color) borderEl.setAttribute('w:color', String(b.color).replace(/^#/, ''))
              tcBorders.appendChild(borderEl)
            }
            tcPr.appendChild(tcBorders)
          }

          if (tcPr.childNodes.length > 0) newEl.appendChild(tcPr)

          const p = docEl.createElementNS(WORD_NS, 'w:p')
          if (props.text !== undefined) {
            const run = docEl.createElementNS(WORD_NS, 'w:r')
            const t = docEl.createElementNS(WORD_NS, 'w:t')
            t.textContent = String(props.text)
            run.appendChild(t)
            p.appendChild(run)
          }
          newEl.appendChild(p)
          break
        }

        case 'text': {
          // Adding text means adding a run to the parent paragraph
          newEl = docEl.createElementNS(WORD_NS, 'w:r')
          const t = docEl.createElementNS(WORD_NS, 'w:t')
          t.textContent = String(props.text ?? '')
          if (/^\s+|\s+$/.test(String(props.text ?? ''))) {
            t.setAttribute('xml:space', 'preserve')
          }
          newEl.appendChild(t)
          break
        }

        case 'formula': {
          // LaTeX → OMML converter (basic subset)
          const latex = String(props.latex || '')
          if (!latex) {
            return {
              data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
              error: 'Formula requires props.latex to be set',
            }
          }
          const omml = convertLatexToOmml(latex, docEl)
          newEl = docEl.createElementNS(WORD_NS, 'w:r')
          newEl.appendChild(omml)
          break
        }

        default:
          return {
            data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
            error: `Unsupported element type: ${input.type}`,
          }
      }

      // Insert at specified index or append
      if (insertIndex >= 0 && insertIndex < parent.childNodes.length) {
        let elementIndex = 0
        for (let i = 0; i < parent.childNodes.length; i++) {
          const child = parent.childNodes[i]
          if (child.nodeType === 1) {
            if (elementIndex === insertIndex) {
              parent.insertBefore(newEl, child)
              break
            }
            elementIndex++
          }
        }
      } else {
        parent.appendChild(newEl)
      }

      doc.isDirty = true
      const saveResult = await saveDocx(doc)
      if (!saveResult.success) {
        return {
          data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
          error: saveResult.error?.message || 'Failed to save document',
        }
      }

      return {
        data: { filePath: input.filePath, parentPath: input.parentPath, type: input.type },
        preview: `Added ${input.type} to ${input.parentPath}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    return `wordAdd ${input.filePath} ${input.parentPath} --type ${input.type}`
  },
}


