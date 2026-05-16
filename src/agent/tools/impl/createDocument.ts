/**
 * CreateDocument — 从 Markdown 内容直接创建新的 Word (.docx) 文件
 *
 * 适用于：从零生成报告、论文、开题报告等文档。
 * 支持：段落、标题、粗体、上标/下标、表格、公式。
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'

const inputSchema = z.object({
  path: z.string().describe('Relative path for the new .docx file (e.g. "output/report.docx")'),
  content: z.string().optional().describe(
    'Inline Markdown content for SHORT documents only (< 2KB). For long documents, use sourcePath instead.\n' +
    'Supports: # headings, **bold**, <sup>superscript</sup>, <sub>subscript</sub>, | tables |, $E=mc^2$ formulas.'
  ),
  sourcePath: z.string().optional().describe(
    'Relative path to a Markdown file already written to disk. Use this for LONG documents.\n' +
    'Workflow: 1) writeFile(path="temp.md", content=fullMarkdown) 2) createDocument(path="output.docx", sourcePath="temp.md")'
  ),
}).refine((data) => data.content || data.sourcePath, {
  message: 'Either content or sourcePath must be provided',
})

type Input = z.infer<typeof inputSchema>

interface MdParagraph {
  type: 'paragraph' | 'heading' | 'table' | 'formula'
  text?: string
  level?: number
  runs?: MdRun[]
  rows?: MdTableRow[]
  latex?: string
}

interface MdRun {
  text: string
  bold?: boolean
  superscript?: boolean
  subscript?: boolean
  isFormula?: boolean
}

interface MdTableRow {
  cells: string[]
  isHeader?: boolean
}

export const CreateDocumentTool: Tool<Input, { path: string; paragraphs: number; tables: number }> = {
  name: 'createDocument',
  description:
    'Create a new Word (.docx) file from Markdown content or a Markdown file on disk. ' +
    'This is the RIGHT tool for generating new documents like reports, theses, or proposals. ' +
    'For SHORT content (< 2KB), pass it directly in the "content" parameter. ' +
    'For LONG documents, FIRST write the Markdown to a file with writeFile, THEN call createDocument with "sourcePath". ' +
    'Do NOT use executeCommand + npm scripts for this — use createDocument directly. ' +
    'Supports headings, bold, superscript/subscript, tables, and formulas.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Create document: ${path}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow creating documents' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; paragraphs: number; tables: number }>> {
    const filePath = safePath(input.path, ctx.workspacePath)

    // Resolve content source
    let mdContent = input.content || ''
    if (input.sourcePath) {
      const { readFileSync } = require('fs')
      const sourceFile = safePath(input.sourcePath, ctx.workspacePath)
      if (!existsSync(sourceFile)) {
        return { data: { path: input.path, paragraphs: 0, tables: 0 }, error: `Source file not found: ${input.sourcePath}` }
      }
      mdContent = readFileSync(sourceFile, 'utf-8')
    }

    if (!mdContent.trim()) {
      return { data: { path: input.path, paragraphs: 0, tables: 0 }, error: 'No content provided (content is empty and sourcePath is missing or points to an empty file)' }
    }

    // Ensure parent directory exists
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    try {
      const docx = require('docx')
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Math, MathRun, HeadingLevel, AlignmentType } = docx

      const blocks = parseMarkdown(mdContent)
      const children: any[] = []
      let paragraphCount = 0
      let tableCount = 0

      for (const block of blocks) {
        switch (block.type) {
          case 'heading': {
            const level = block.level || 1
            const headingLevel =
              level === 1 ? HeadingLevel.HEADING_1 :
              level === 2 ? HeadingLevel.HEADING_2 :
              level === 3 ? HeadingLevel.HEADING_3 :
              level === 4 ? HeadingLevel.HEADING_4 :
              level === 5 ? HeadingLevel.HEADING_5 :
              HeadingLevel.HEADING_6
            children.push(
              new Paragraph({
                heading: headingLevel,
                children: runsToTextRuns(block.runs || [{ text: block.text || '' }], docx),
              })
            )
            paragraphCount++
            break
          }
          case 'paragraph': {
            children.push(
              new Paragraph({
                children: runsToTextRuns(block.runs || [{ text: block.text || '' }], docx),
              })
            )
            paragraphCount++
            break
          }
          case 'table': {
            const rows = block.rows || []
            if (rows.length > 0) {
              children.push(
                new Table({
                  rows: rows.map((row) =>
                    new TableRow({
                      children: row.cells.map((cellText) =>
                        new TableCell({
                          children: [new Paragraph({ children: [new TextRun(cellText)] })],
                        })
                      ),
                    })
                  ),
                })
              )
              tableCount++
            }
            break
          }
          case 'formula': {
            const latex = block.latex || ''
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new Math({
                    children: [new MathRun(latex)],
                  }),
                ],
              })
            )
            paragraphCount++
            break
          }
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children,
        }],
      })

      const buffer = await Packer.toBuffer(doc)
      writeFileSync(filePath, buffer)

      return {
        data: { path: input.path, paragraphs: paragraphCount, tables: tableCount },
        preview: `Created ${input.path} (${paragraphCount} paragraphs, ${tableCount} tables)`,
      }
    } catch (err: any) {
      return { data: { path: input.path, paragraphs: 0, tables: 0 }, error: err.message || 'Failed to create document' }
    }
  },

  renderToolUse(input) {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    return `Create document: ${path}`
  },
}

// ── Markdown Parser (mirrors wordFillTemplate logic, adapted for docx package) ──

function parseMarkdown(md: string): MdParagraph[] {
  const blocks: MdParagraph[] = []
  const lines = md.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
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

    // Block formula $$...$$ (supports both single-line and multi-line)
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

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      blocks.push({ type: 'heading', level, text, runs: parseInlineRuns(text) })
      i++
      continue
    }

    // Inline formula / normal paragraph
    if (line.includes('$') && !line.startsWith('|')) {
      blocks.push({ type: 'paragraph', runs: parseInlineWithFormulas(line) })
    } else {
      const text = line
      if (text) {
        blocks.push({ type: 'paragraph', text, runs: parseInlineRuns(text) })
      }
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
      runs.push({ text: m[2], isFormula: true })
    } else if (m[3]) {
      runs.push(...parseInlineRuns(m[3]))
    }
  }
  if (runs.length === 0) runs.push({ text })
  return runs
}

function runsToTextRuns(runs: MdRun[], docx: any): any[] {
  const { TextRun, Math, MathRun } = docx
  return runs.map((run) => {
    if (run.isFormula) {
      return new Math({ children: [new MathRun(run.text)] })
    }
    return new TextRun({
      text: run.text,
      bold: run.bold || false,
      superScript: run.superscript || false,
      subScript: run.subscript || false,
    })
  })
}
