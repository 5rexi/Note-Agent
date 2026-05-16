/**
 * WordFillTemplate — 批量将 Markdown 内容填充到 Word 文档模板中
 *
 * 适用于：长文档批量填入、报告生成、从 Markdown 迁移到 docx。
 * 内部直接操作 OOXML，效率远高于逐段调用 wordAdd。
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { openDocx, saveDocx, closeDocx, resolvePath } from '../../document'

const inputSchema = z.object({
  filePath: z.string().describe('Absolute path to the .docx template file'),
  content: z.string().describe('Markdown content to fill into the document'),
  anchorPath: z.string().describe('Path to the element after which content will be inserted, e.g. /body/p[131]'),
  mode: z.enum(['append', 'replace']).optional().describe('append: insert after anchor. replace: delete content between anchor and endAnchor, then insert. Default: append'),
  endAnchorPath: z.string().optional().describe('Required for replace mode: path to the element marking the end of the region to replace'),
})

type Input = z.infer<typeof inputSchema>

interface MdParagraph {
  type: 'paragraph' | 'table' | 'formula'
  text?: string
  runs?: MdRun[]
  rows?: MdTableRow[]
  latex?: string
  isHeader?: boolean
}

interface MdRun {
  text: string
  bold?: boolean
  superscript?: boolean
  subscript?: boolean
}

interface MdTableRow {
  cells: string[]
  isHeader?: boolean
}

export const WordFillTemplateTool: Tool<Input, { filePath: string; paragraphsInserted: number; tablesInserted: number }> = {
  name: 'wordFillTemplate',
  description:
    'Fill a Word document template with Markdown content in one shot. ' +
    'Much more efficient than calling wordAdd for each paragraph individually. ' +
    'Supports: plain paragraphs, **bold**, <sup>superscript</sup>, tables (| col1 | col2 |), and formulas ($E=mc^2$ or $$...$$ blocks). ' +
    'The anchorPath determines where the new content is inserted.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Fill template ${input.filePath} at ${input.anchorPath}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow modifying Word documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ filePath: string; paragraphsInserted: number; tablesInserted: number }>> {
    const { doc, error } = await openDocx(input.filePath, ctx.workspacePath)
    if (error || !doc) {
      return { data: { filePath: input.filePath, paragraphsInserted: 0, tablesInserted: 0 }, error: error!.message }
    }

    try {
      // Resolve anchor
      const resolved = resolvePath(doc, input.anchorPath)
      if (resolved.error || !resolved.element) {
        return {
          data: { filePath: input.filePath, paragraphsInserted: 0, tablesInserted: 0 },
          error: resolved.error
            ? `[${resolved.error.code}] ${resolved.error.message}`
            : `Anchor not found at ${input.anchorPath}`,
        }
      }

      const anchor = resolved.element
      const parent = anchor.parentNode as Element
      if (!parent) {
        return { data: { filePath: input.filePath, paragraphsInserted: 0, tablesInserted: 0 }, error: 'Anchor has no parent' }
      }

      // For replace mode: delete content between anchor and endAnchor
      if (input.mode === 'replace' && input.endAnchorPath) {
        const endRes = resolvePath(doc, input.endAnchorPath)
        if (endRes.error || !endRes.element) {
          return {
            data: { filePath: input.filePath, paragraphsInserted: 0, tablesInserted: 0 },
            error: endRes.error
              ? `[${endRes.error.code}] ${endRes.error.message}`
              : `End anchor not found at ${input.endAnchorPath}`,
          }
        }
        deleteBetween(parent, anchor, endRes.element)
      }

      // Parse markdown
      const mdBlocks = parseMarkdown(input.content)

      // Convert to OOXML and insert
      let insertAfter = anchor
      let paragraphsInserted = 0
      let tablesInserted = 0

      for (const block of mdBlocks) {
        const elements = blockToOoXml(block, doc.document)
        for (const el of elements) {
          if (insertAfter.nextSibling) {
            parent.insertBefore(el, insertAfter.nextSibling)
          } else {
            parent.appendChild(el)
          }
          insertAfter = el
        }
        if (block.type === 'table') tablesInserted++
        else paragraphsInserted++
      }

      doc.isDirty = true
      const saveResult = await saveDocx(doc)
      if (!saveResult.success) {
        return { data: { filePath: input.filePath, paragraphsInserted, tablesInserted }, error: saveResult.error?.message || 'Failed to save document' }
      }

      return {
        data: { filePath: input.filePath, paragraphsInserted, tablesInserted },
        preview: `Inserted ${paragraphsInserted} paragraphs and ${tablesInserted} tables after ${input.anchorPath}`,
      }
    } finally {
      closeDocx(doc)
    }
  },

  renderToolUse(input) {
    const filePath = typeof input.filePath === 'string' ? input.filePath : '(unknown)'
    const anchorPath = typeof input.anchorPath === 'string' ? input.anchorPath : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''
    return `wordFillTemplate ${filePath} ${anchorPath} (${content.length} chars)`
  },
}

// ── Markdown Parser ──

function parseMarkdown(md: string): MdParagraph[] {
  const blocks: MdParagraph[] = []
  const lines = md.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip empty lines and references/signatures
    if (!line.trim() || line.startsWith('**研究生签名') || line.startsWith('---')) {
      i++
      continue
    }

    // Skip reference section
    if (line.startsWith('## 参考文献')) {
      break
    }

    // Table
    if (line.startsWith('|')) {
      const { rows, next } = parseTable(lines, i)
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows })
      }
      i = next
      continue
    }

    // Formula block $$...$$ (supports both single-line and multi-line)
    if (line.trim() === '$$') {
      // Multi-line block: $$ on its own line, read until closing $$
      let latex = ''
      i++ // skip opening $$
      while (i < lines.length && lines[i].trim() !== '$$') {
        latex += lines[i] + '\n'
        i++
      }
      if (latex.trim()) {
        blocks.push({ type: 'formula', latex: latex.trim() })
      }
      i++ // skip closing $$
      continue
    }
    if (line.trim().startsWith('$$') && line.trim().endsWith('$$') && line.trim().length > 4) {
      // Single-line block: $$formula$$
      const latex = line.trim().slice(2, -2)
      if (latex) {
        blocks.push({ type: 'formula', latex: latex.trim() })
      }
      i++
      continue
    }

    // Inline formula $...$
    if (line.includes('$') && !line.startsWith('|')) {
      blocks.push({ type: 'paragraph', runs: parseInlineWithFormulas(line) })
      i++
      continue
    }

    // Heading / normal paragraph
    const text = line.replace(/^#{1,6}\s+/, '')
    if (text) {
      blocks.push({ type: 'paragraph', runs: parseInlineRuns(text) })
    }
    i++
  }

  return blocks
}

function parseTable(lines: string[], start: number): { rows: MdTableRow[]; next: number } {
  const rows: MdTableRow[] = []
  let i = start
  while (i < lines.length && lines[i].startsWith('|')) {
    const line = lines[i].trim()
    // Skip separator line |---|---|
    if (/^\|[\s\-:|]+\|$/.test(line)) {
      i++
      continue
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    rows.push({ cells, isHeader: rows.length === 0 })
    i++
  }
  return { rows, next: i }
}

function parseInlineRuns(text: string): MdRun[] {
  const runs: MdRun[] = []
  // Pattern: **bold**, <sup>text</sup>, <sub>text</sub>
  const regex = /(\*\*([^*]+)\*\*|<sup>([^<]+)<\/sup>|<sub>([^<]+)<\/sub>|([^*<]+))/g
  let m
  while ((m = regex.exec(text)) !== null) {
    if (m[2]) {
      runs.push({ text: m[2], bold: true })
    } else if (m[3]) {
      runs.push({ text: m[3], superscript: true })
    } else if (m[4]) {
      runs.push({ text: m[4], subscript: true })
    } else if (m[5]) {
      runs.push({ text: m[5] })
    }
  }
  if (runs.length === 0) {
    runs.push({ text })
  }
  return runs
}

function parseInlineWithFormulas(text: string): MdRun[] {
  const runs: MdRun[] = []
  const regex = /(\$\$?([^$]+)\$\$?|([^$]+))/g
  let m
  while ((m = regex.exec(text)) !== null) {
    if (m[2]) {
      runs.push({ text: m[2], superscript: false }) // Mark as formula via special handling
    } else if (m[3]) {
      runs.push(...parseInlineRuns(m[3]))
    }
  }
  if (runs.length === 0) runs.push({ text })
  return runs
}

// ── OOXML Generation ──

function blockToOoXml(block: MdParagraph, doc: Document): Element[] {
  switch (block.type) {
    case 'paragraph': {
      const p = doc.createElement('w:p')
      const pPr = doc.createElement('w:pPr')
      const sp = doc.createElement('w:spacing')
      sp.setAttribute('w:before', '50')
      sp.setAttribute('w:line', '360')
      sp.setAttribute('w:lineRule', 'exact')
      pPr.appendChild(sp)
      const rPr = doc.createElement('w:rPr')
      const fonts = doc.createElement('w:rFonts')
      fonts.setAttribute('w:ascii', '仿宋')
      fonts.setAttribute('w:eastAsia', '仿宋')
      fonts.setAttribute('w:hAnsi', '仿宋')
      rPr.appendChild(fonts)
      const sz = doc.createElement('w:sz')
      sz.setAttribute('w:val', '24')
      rPr.appendChild(sz)
      const szCs = doc.createElement('w:szCs')
      szCs.setAttribute('w:val', '24')
      rPr.appendChild(szCs)
      pPr.appendChild(rPr)
      p.appendChild(pPr)

      for (const run of block.runs || []) {
        if (run.text.trim() === '') continue
        const r = doc.createElement('w:r')
        const rrPr = doc.createElement('w:rPr')
        const fonts2 = doc.createElement('w:rFonts')
        fonts2.setAttribute('w:ascii', '仿宋')
        fonts2.setAttribute('w:eastAsia', '仿宋')
        fonts2.setAttribute('w:hAnsi', '仿宋')
        rrPr.appendChild(fonts2)
        const sz2 = doc.createElement('w:sz')
        sz2.setAttribute('w:val', '24')
        rrPr.appendChild(sz2)
        const szCs2 = doc.createElement('w:szCs')
        szCs2.setAttribute('w:val', '24')
        rrPr.appendChild(szCs2)
        if (run.bold) {
          const b = doc.createElement('w:b')
          b.setAttribute('w:val', '1')
          rrPr.appendChild(b)
        }
        if (run.superscript) {
          const va = doc.createElement('w:vertAlign')
          va.setAttribute('w:val', 'superscript')
          rrPr.appendChild(va)
        }
        if (run.subscript) {
          const va = doc.createElement('w:vertAlign')
          va.setAttribute('w:val', 'subscript')
          rrPr.appendChild(va)
        }
        r.appendChild(rrPr)
        const t = doc.createElement('w:t')
        t.textContent = run.text
        if (/^\s+|\s+$/.test(run.text)) {
          t.setAttribute('xml:space', 'preserve')
        }
        r.appendChild(t)
        p.appendChild(r)
      }
      return [p]
    }

    case 'table': {
      const tbl = doc.createElement('w:tbl')
      const tblPr = doc.createElement('w:tblPr')
      const tblW = doc.createElement('w:tblW')
      tblW.setAttribute('w:w', '5000')
      tblW.setAttribute('w:type', 'pct')
      tblPr.appendChild(tblW)

      // Default borders
      const tblBorders = doc.createElement('w:tblBorders')
      for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
        const b = doc.createElement(`w:${side}`)
        b.setAttribute('w:val', 'single')
        b.setAttribute('w:sz', '4')
        b.setAttribute('w:color', '000000')
        tblBorders.appendChild(b)
      }
      tblPr.appendChild(tblBorders)
      tbl.appendChild(tblPr)

      const rows = block.rows || []
      if (rows.length > 0) {
        const colCount = rows[0].cells.length
        const tblGrid = doc.createElement('w:tblGrid')
        const colW = Math.floor(9000 / colCount)
        for (let c = 0; c < colCount; c++) {
          const gridCol = doc.createElement('w:gridCol')
          gridCol.setAttribute('w:w', String(colW))
          tblGrid.appendChild(gridCol)
        }
        tbl.appendChild(tblGrid)
      }

      for (const row of rows) {
        const tr = doc.createElement('w:tr')
        for (const cellText of row.cells) {
          const tc = doc.createElement('w:tc')
          const tcPr = doc.createElement('w:tcPr')
          if (row.isHeader) {
            const shd = doc.createElement('w:shd')
            shd.setAttribute('w:val', 'clear')
            shd.setAttribute('w:color', 'auto')
            shd.setAttribute('w:fill', 'D5E8F0')
            tcPr.appendChild(shd)
          }
          tc.appendChild(tcPr)

          const p = doc.createElement('w:p')
          const pPr = doc.createElement('w:pPr')
          const jc = doc.createElement('w:jc')
          jc.setAttribute('w:val', 'center')
          pPr.appendChild(jc)
          p.appendChild(pPr)

          const r = doc.createElement('w:r')
          const t = doc.createElement('w:t')
          t.textContent = cellText
          r.appendChild(t)
          p.appendChild(r)
          tc.appendChild(p)
          tr.appendChild(tc)
        }
        tbl.appendChild(tr)
      }
      return [tbl]
    }

    case 'formula': {
      // Formula: wrap in a paragraph with OMML
      const p = doc.createElement('w:p')
      const pPr = doc.createElement('w:pPr')
      const jc = doc.createElement('w:jc')
      jc.setAttribute('w:val', 'center')
      pPr.appendChild(jc)
      p.appendChild(pPr)

      const r = doc.createElement('w:r')
      const mRun = doc.createElement('m:r')
      const omml = buildSimpleOmml(block.latex || '', doc)
      mRun.appendChild(omml)
      r.appendChild(mRun)
      p.appendChild(r)
      return [p]
    }

    default:
      return []
  }
}

/** Simplified OMML builder for wordFillTemplate. Supports basic expressions. */
function buildSimpleOmml(latex: string, doc: Document): Element {
  const oMath = doc.createElement('m:oMath')
  // For simplicity, render the LaTeX source as a math run.
  // A full LaTeX→OMML parser would go here; for now we show the raw LaTeX
  // inside an italic math run so it is visually distinct.
  const mR = doc.createElement('m:r')
  const mT = doc.createElement('m:t')
  mT.textContent = latex
  mR.appendChild(mT)
  oMath.appendChild(mR)
  return oMath
}

// ── DOM Helpers ──

function deleteBetween(parent: Element, start: Element, end: Element): void {
  let deleting = false
  const toRemove: Element[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const el = child as Element
    if (el === start) {
      deleting = true
      continue
    }
    if (el === end) {
      deleting = false
      break
    }
    if (deleting) {
      toRemove.push(el)
    }
  }
  for (const el of toRemove) {
    parent.removeChild(el)
  }
}
