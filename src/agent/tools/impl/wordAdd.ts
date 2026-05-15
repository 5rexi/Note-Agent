import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'

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
          newEl = docEl.createElement('w:p')
          const pPr = docEl.createElement('w:pPr')
          if (props.alignment) {
            const jc = docEl.createElement('w:jc')
            jc.setAttribute('w:val', String(props.alignment))
            pPr.appendChild(jc)
          }
          if (props.headingLevel) {
            const level = Math.max(1, Math.min(6, Number(props.headingLevel)))
            const style = docEl.createElement('w:pStyle')
            style.setAttribute('w:val', `Heading${level}`)
            pPr.appendChild(style)
          }
          if (props.style) {
            const style = docEl.createElement('w:pStyle')
            style.setAttribute('w:val', String(props.style))
            pPr.appendChild(style)
          }
          if (pPr.childNodes.length > 0) newEl.appendChild(pPr)

          if (props.text !== undefined) {
            const run = docEl.createElement('w:r')
            const t = docEl.createElement('w:t')
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
          newEl = docEl.createElement('w:r')
          const rPr = docEl.createElement('w:rPr')
          if (props.bold) {
            const b = docEl.createElement('w:b')
            b.setAttribute('w:val', '1')
            rPr.appendChild(b)
          }
          if (props.italic) {
            const i = docEl.createElement('w:i')
            i.setAttribute('w:val', '1')
            rPr.appendChild(i)
          }
          if (props.fontSize) {
            const sz = docEl.createElement('w:sz')
            sz.setAttribute('w:val', String(props.fontSize))
            rPr.appendChild(sz)
          }
          if (props.color) {
            const color = docEl.createElement('w:color')
            color.setAttribute('w:val', String(props.color).replace(/^#/, ''))
            rPr.appendChild(color)
          }
          if (props.superscript) {
            const va = docEl.createElement('w:vertAlign')
            va.setAttribute('w:val', 'superscript')
            rPr.appendChild(va)
          }
          if (props.subscript) {
            const va = docEl.createElement('w:vertAlign')
            va.setAttribute('w:val', 'subscript')
            rPr.appendChild(va)
          }
          if (rPr.childNodes.length > 0) newEl.appendChild(rPr)

          const t = docEl.createElement('w:t')
          t.textContent = String(props.text ?? '')
          if (/^\s+|\s+$/.test(String(props.text ?? ''))) {
            t.setAttribute('xml:space', 'preserve')
          }
          newEl.appendChild(t)
          break
        }

        case 'table': {
          newEl = docEl.createElement('w:tbl')
          const tblPr = docEl.createElement('w:tblPr')

          // Table width
          const tblW = docEl.createElement('w:tblW')
          tblW.setAttribute('w:w', '5000')
          tblW.setAttribute('w:type', 'pct')
          tblPr.appendChild(tblW)

          // Column widths
          if (props.columnWidths && Array.isArray(props.columnWidths)) {
            const tblGrid = docEl.createElement('w:tblGrid')
            for (const cw of props.columnWidths) {
              const gridCol = docEl.createElement('w:gridCol')
              gridCol.setAttribute('w:w', String(cw))
              tblGrid.appendChild(gridCol)
            }
            newEl.appendChild(tblGrid)
          }

          // Borders
          if (props.borders) {
            const tblBorders = docEl.createElement('w:tblBorders')
            for (const [side, cfg] of Object.entries(props.borders)) {
              const borderEl = docEl.createElement(`w:${side}`)
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
            const jc = docEl.createElement('w:jc')
            jc.setAttribute('w:val', String(props.alignment))
            tblPr.appendChild(jc)
          }

          newEl.appendChild(tblPr)
          break
        }

        case 'tableRow': {
          newEl = docEl.createElement('w:tr')
          break
        }

        case 'tableCell': {
          newEl = docEl.createElement('w:tc')
          const tcPr = docEl.createElement('w:tcPr')

          // Cell width
          if (props.width) {
            const tcW = docEl.createElement('w:tcW')
            tcW.setAttribute('w:w', String(props.width))
            tcW.setAttribute('w:type', props.widthType || 'dxa')
            tcPr.appendChild(tcW)
          }

          // Column span (merge cells horizontally)
          if (props.gridSpan) {
            const gs = docEl.createElement('w:gridSpan')
            gs.setAttribute('w:val', String(props.gridSpan))
            tcPr.appendChild(gs)
          }

          // Row span (merge cells vertically)
          if (props.vMerge) {
            const vm = docEl.createElement('w:vMerge')
            vm.setAttribute('w:val', String(props.vMerge)) // 'restart' or 'continue'
            tcPr.appendChild(vm)
          }

          // Shading (background color)
          if (props.shading) {
            const shd = docEl.createElement('w:shd')
            shd.setAttribute('w:val', 'clear')
            shd.setAttribute('w:color', 'auto')
            shd.setAttribute('w:fill', String(props.shading).replace(/^#/, ''))
            tcPr.appendChild(shd)
          }

          // Cell borders
          if (props.borders) {
            const tcBorders = docEl.createElement('w:tcBorders')
            for (const [side, cfg] of Object.entries(props.borders)) {
              const borderEl = docEl.createElement(`w:${side}`)
              const b = cfg as Record<string, string>
              if (b.style) borderEl.setAttribute('w:val', b.style)
              if (b.size) borderEl.setAttribute('w:sz', String(b.size))
              if (b.color) borderEl.setAttribute('w:color', String(b.color).replace(/^#/, ''))
              tcBorders.appendChild(borderEl)
            }
            tcPr.appendChild(tcBorders)
          }

          if (tcPr.childNodes.length > 0) newEl.appendChild(tcPr)

          const p = docEl.createElement('w:p')
          if (props.text !== undefined) {
            const run = docEl.createElement('w:r')
            const t = docEl.createElement('w:t')
            t.textContent = String(props.text)
            run.appendChild(t)
            p.appendChild(run)
          }
          newEl.appendChild(p)
          break
        }

        case 'text': {
          // Adding text means adding a run to the parent paragraph
          newEl = docEl.createElement('w:r')
          const t = docEl.createElement('w:t')
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
          const omml = latexToOmml(latex, docEl)
          newEl = docEl.createElement('w:r')
          const mRun = docEl.createElement('m:r')
          mRun.appendChild(omml)
          newEl.appendChild(mRun)
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

// ── LaTeX → OMML (Office Math Markup Language) converter ──

/** Greek letter and symbol mapping: LaTeX command → Unicode character */
const LATEX_SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', pm: '±', leq: '≤', geq: '≥', neq: '≠',
  infty: '∞', partial: '∂', nabla: '∇', approx: '≈', sim: '∼',
  cdot: '·', ldots: '…', forall: '∀', exists: '∃', in: '∈',
  subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
  sqrt: '', frac: '', sum: '∑', prod: '∏', int: '∫',
}

/**
 * Convert a LaTeX math expression to an OMML <m:oMath> element.
 * Supports: text, superscripts (^), subscripts (_), fractions (\frac),
 * square roots (\sqrt), Greek letters, and common symbols.
 */
function latexToOmml(latex: string, doc: Document): Element {
  const tokens = tokenizeLatex(latex)
  const oMath = doc.createElement('m:oMath')
  const { element } = parseTokens(tokens, 0, doc)
  if (element) oMath.appendChild(element)
  return oMath
}

interface Token {
  type: 'text' | 'command' | 'superscript' | 'subscript' | 'lbrace' | 'rbrace' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket'
  value: string
}

function tokenizeLatex(latex: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < latex.length) {
    const ch = latex[i]
    if (ch === '^') { tokens.push({ type: 'superscript', value: '^' }); i++; continue }
    if (ch === '_') { tokens.push({ type: 'subscript', value: '_' }); i++; continue }
    if (ch === '{') { tokens.push({ type: 'lbrace', value: '{' }); i++; continue }
    if (ch === '}') { tokens.push({ type: 'rbrace', value: '}' }); i++; continue }
    if (ch === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue }
    if (ch === '[') { tokens.push({ type: 'lbracket', value: '[' }); i++; continue }
    if (ch === ']') { tokens.push({ type: 'rbracket', value: ']' }); i++; continue }
    if (ch === '\\') {
      let j = i + 1
      while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++
      const cmd = latex.slice(i + 1, j)
      tokens.push({ type: 'command', value: cmd })
      i = j
      continue
    }
    if (/\s/.test(ch)) { i++; continue }
    let j = i
    while (j < latex.length && !/^[\\^{}()_\[\]\s]$/.test(latex[j])) j++
    tokens.push({ type: 'text', value: latex.slice(i, j) })
    i = j
  }
  return tokens
}

function parseTokens(tokens: Token[], start: number, doc: Document): { element: Element | null; nextIndex: number } {
  const parts: Element[] = []
  let i = start

  while (i < tokens.length) {
    const tok = tokens[i]

    if (tok.type === 'rbrace' || tok.type === 'rparen' || tok.type === 'rbracket') {
      break
    }

    if (tok.type === 'text') {
      const run = makeMathRun(tok.value, doc)
      parts.push(run)
      i++
      continue
    }

    if (tok.type === 'command') {
      const sym = LATEX_SYMBOLS[tok.value]
      if (tok.value === 'frac') {
        const { num, den, next } = parseFrac(tokens, i, doc)
        if (num && den) {
          const frac = doc.createElement('m:f')
          const numEl = doc.createElement('m:num')
          numEl.appendChild(num)
          const denEl = doc.createElement('m:den')
          denEl.appendChild(den)
          frac.appendChild(numEl)
          frac.appendChild(denEl)
          parts.push(frac)
        }
        i = next
        continue
      }
      if (tok.value === 'sqrt') {
        const { body, next } = parseSqrt(tokens, i, doc)
        if (body) {
          const rad = doc.createElement('m:rad')
          const deg = doc.createElement('m:deg')
          deg.appendChild(makeMathRun('', doc))
          rad.appendChild(deg)
          const e = doc.createElement('m:e')
          e.appendChild(body)
          rad.appendChild(e)
          parts.push(rad)
        }
        i = next
        continue
      }
      if (sym !== undefined) {
        const run = makeMathRun(sym, doc)
        parts.push(run)
        i++
        continue
      }
      // Unknown command: skip
      i++
      continue
    }

    if (tok.type === 'lparen' || tok.type === 'lbracket') {
      const closeType = tok.type === 'lparen' ? 'rparen' : 'rbracket'
      const closeChar = tok.type === 'lparen' ? ')' : ']'
      const { content, next } = parseGroup(tokens, i + 1, closeType, doc)
      if (content) {
        const d = doc.createElement('m:d')
        const dPr = doc.createElement('m:dPr')
        const begChr = doc.createElement('m:begChr')
        begChr.setAttribute('m:val', tok.value)
        dPr.appendChild(begChr)
        const endChr = doc.createElement('m:endChr')
        endChr.setAttribute('m:val', closeChar)
        dPr.appendChild(endChr)
        d.appendChild(dPr)
        const e = doc.createElement('m:e')
        e.appendChild(content)
        d.appendChild(e)
        parts.push(d)
      }
      i = next
      continue
    }

    if (tok.type === 'lbrace') {
      const { content, next } = parseGroup(tokens, i + 1, 'rbrace', doc)
      if (content) parts.push(content)
      i = next
      continue
    }

    if (tok.type === 'superscript' || tok.type === 'subscript') {
      // Look back for the base (last part)
      if (parts.length === 0) { i++; continue }
      const base = parts.pop()!
      const { content, next } = parseSingleArg(tokens, i + 1, doc)
      if (content) {
        if (tok.type === 'superscript') {
          const sSup = doc.createElement('m:sSup')
          const e = doc.createElement('m:e')
          e.appendChild(base)
          const sup = doc.createElement('m:sup')
          sup.appendChild(content)
          sSup.appendChild(e)
          sSup.appendChild(sup)
          parts.push(sSup)
        } else {
          const sSub = doc.createElement('m:sSub')
          const e = doc.createElement('m:e')
          e.appendChild(base)
          const sub = doc.createElement('m:sub')
          sub.appendChild(content)
          sSub.appendChild(e)
          sSub.appendChild(sub)
          parts.push(sSub)
        }
      } else {
        parts.push(base)
      }
      i = next
      continue
    }

    i++
  }

  if (parts.length === 0) return { element: null, nextIndex: i }
  if (parts.length === 1) return { element: parts[0], nextIndex: i }

  // Multiple parts: wrap in a group with implicit addition
  const group = doc.createElement('m:r')
  const t = doc.createElement('m:t')
  let text = ''
  for (const p of parts) {
    if (p.tagName === 'm:r') {
      const tNodes = p.getElementsByTagName('m:t')
      if (tNodes.length > 0) text += tNodes[0].textContent || ''
    }
  }
  t.textContent = text
  group.appendChild(t)
  return { element: group, nextIndex: i }
}

function makeMathRun(text: string, doc: Document): Element {
  const r = doc.createElement('m:r')
  const t = doc.createElement('m:t')
  t.textContent = text
  r.appendChild(t)
  return r
}

function parseGroup(tokens: Token[], start: number, endType: string, doc: Document): { content: Element | null; next: number } {
  const { element, nextIndex } = parseTokens(tokens, start, doc)
  // Expect endType at nextIndex
  if (nextIndex < tokens.length && tokens[nextIndex].type === endType) {
    return { content: element, next: nextIndex + 1 }
  }
  return { content: element, next: nextIndex }
}

function parseSingleArg(tokens: Token[], start: number, doc: Document): { content: Element | null; next: number } {
  if (start >= tokens.length) return { content: null, next: start }
  if (tokens[start].type === 'lbrace') {
    return parseGroup(tokens, start + 1, 'rbrace', doc)
  }
  // Single token arg
  const tok = tokens[start]
  if (tok.type === 'text' || tok.type === 'command') {
    const text = tok.type === 'command' ? (LATEX_SYMBOLS[tok.value] || tok.value) : tok.value
    return { content: makeMathRun(text, doc), next: start + 1 }
  }
  return { content: null, next: start + 1 }
}

function parseFrac(tokens: Token[], start: number, doc: Document): { num: Element | null; den: Element | null; next: number } {
  let i = start + 1
  const num = parseSingleArg(tokens, i, doc)
  const den = parseSingleArg(tokens, num.next, doc)
  return { num: num.content, den: den.content, next: den.next }
}

function parseSqrt(tokens: Token[], start: number, doc: Document): { body: Element | null; next: number } {
  let i = start + 1
  const body = parseSingleArg(tokens, i, doc)
  return { body: body.content, next: body.next }
}
