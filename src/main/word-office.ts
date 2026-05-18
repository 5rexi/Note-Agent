// ipcMain is lazy-loaded in registerWordHandlers() to support CLI environments
import { spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'fs'
import { join, dirname, basename, relative } from 'path'
import { tmpdir, homedir } from 'os'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { savePdfCache, getCachedPdfPath, invalidateCache } from './pdf-cache'
import {
  unpackDocx as unpackDocxCore,
  packDocx as packDocxCore,
  prettyPrintXml as prettyPrintXmlCore,
  autoRepairXml as autoRepairXmlCore,
  replaceParagraphText as replaceParagraphTextCore,
  addParagraphText as addParagraphTextCore,
  deleteParagraph as deleteParagraphCore,
  modifyParagraphFormat as modifyParagraphFormatCore,
  modifyGlobalFormat as modifyGlobalFormatCore,
  sanitizeXmlString,
  extractDocxRawText,
  type FormatChange,
} from '../agent/document'

function getDb() {
  return (global as any).__db as import('./db').Database | undefined
}

// ── Get configured/bundled soffice ──

function getConfiguredSoffice(): string | null {
  try {
    const db = (global as any).__db
    if (!db) return null
    const raw = db.getSetting('wordSupport')
    if (!raw) return null
    const config = JSON.parse(raw)
    if (!config.enabled) return null
    if (config.sofficeType === 'system-auto' || config.sofficeType === 'system-manual') {
      return config.sofficePath || null
    }
    if (config.sofficeType === 'bundled') {
      return config.bundledPath || null
    }
  } catch {
    // ignore
  }
  return null
}

let cachedSystemSoffice: string | null | undefined = undefined

function findSystemSoffice(): string | null {
  if (cachedSystemSoffice !== undefined) return cachedSystemSoffice
  const { execSync } = require('child_process')
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'
  const names = isWindows ? ['soffice.exe', 'soffice'] : ['soffice', 'libreoffice']
  for (const name of names) {
    try {
      const result = execSync(`${cmd} ${name}`, { encoding: 'utf-8', timeout: 3000, env: process.env }).trim().split('\n')[0]
      if (result) {
        cachedSystemSoffice = result
        return result
      }
    } catch {
      continue
    }
  }
  cachedSystemSoffice = null
  return null
}

export function getEffectiveSoffice(): string | null {
  const configured = getConfiguredSoffice()
  if (configured) return configured
  return findSystemSoffice()
}

function invalidateSofficeCache() {
  cachedSystemSoffice = undefined
}

// ── Conversion helpers ──

export async function convertWithSoffice(filePath: string, targetFormat: string): Promise<{ pdfPath?: string; error?: string }> {
  // Check cache first for PDF output
  if (targetFormat === 'pdf') {
    const cached = getCachedPdfPath(filePath)
    if (cached.isFresh && cached.pdfPath) {
      return { pdfPath: cached.pdfPath }
    }
  }

  const soffice = getEffectiveSoffice()
  if (!soffice) {
    return { error: '未找到 LibreOffice (soffice)。请在"设置 → 文件支持 → Word"中配置。' }
  }

  const outputDir = tmpdir()
  const baseName = basename(filePath).replace(/\.(docx|doc|pptx|xlsx|xls|odt)$/i, '')
  const tempOutput = join(outputDir, `${baseName}.${targetFormat}`)

  if (existsSync(tempOutput)) {
    try { unlinkSync(tempOutput) } catch {}
  }

  return new Promise((resolve) => {
    const args = ['--headless', '--convert-to', targetFormat, '--outdir', outputDir, filePath]
    const proc = spawn(soffice, args, {
      env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE || homedir() },
      timeout: 120000,
    })

    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0 && existsSync(tempOutput)) {
        if (targetFormat === 'pdf') {
          try {
            const pdfBuffer = readFileSync(tempOutput)
            const cachedPath = savePdfCache(filePath, pdfBuffer)
            unlinkSync(tempOutput)
            resolve({ pdfPath: cachedPath })
          } catch (err: any) {
            resolve({ error: `缓存保存失败: ${err.message}` })
          }
        } else {
          resolve({ pdfPath: tempOutput })
        }
      } else {
        resolve({ error: `LibreOffice 转换失败 (exit ${code}): ${stderr || '未知错误'}` })
      }
    })

    proc.on('error', (err) => {
      resolve({ error: `LibreOffice 启动失败: ${err.message}` })
    })
  })
}

// ── Open with LibreOffice ──

function openWithLibreOffice(filePath: string): { success: boolean; error?: string } {
  const soffice = getEffectiveSoffice()
  if (!soffice) {
    return { success: false, error: '未找到 LibreOffice。请在"设置 → 文件支持 → Word"中配置。' }
  }

  try {
    const proc = spawn(soffice, [filePath], {
      detached: true,
      stdio: 'ignore',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    })
    proc.unref()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || '启动 LibreOffice 失败' }
  }
}

// ── System default open (no LibreOffice) ──

function openWithSystemDefault(filePath: string): { success: boolean; error?: string } {
  try {
    // Use Electron's shell API to avoid shell command injection
    const { shell } = require('electron')
    const result = shell.openPath(filePath)
    if (result !== '') {
      return { success: false, error: result }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || '打开文件失败' }
  }
}

// ── Pandoc helpers (lightweight alternative to LibreOffice) ──

function findPandoc(): string | null {
  // 1. Check user-configured path first
  try {
    const db = (global as any).__db
    if (db) {
      const raw = db.getSetting('pandocSupport')
      if (raw) {
        const config = JSON.parse(raw)
        if (config.enabled && config.path && existsSync(config.path)) {
          return config.path
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Fall back to system PATH
  try {
    const { execSync } = require('child_process')
    const cmd = process.platform === 'win32' ? 'where pandoc' : 'which pandoc'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 3000, env: process.env }).trim().split('\n')[0]
    return result || null
  } catch {
    return null
  }
}

export function getPandocInfo(): { installed: boolean; path: string | null; version: string | null } {
  const path = findPandoc()
  if (!path) return { installed: false, path: null, version: null }
  try {
    const { execSync } = require('child_process')
    const version = execSync(`"${path}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0]
    return { installed: true, path, version }
  } catch {
    return { installed: true, path, version: null }
  }
}

export function verifyPandocPath(customPath: string): { ok: boolean; version: string | null; error?: string } {
  try {
    const { execSync } = require('child_process')
    const version = execSync(`"${customPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0]
    return { ok: true, version }
  } catch (err: any) {
    return { ok: false, version: null, error: err.message || '验证失败' }
  }
}

export async function convertDocToDocxWithPandoc(filePath: string): Promise<{ outputPath?: string; error?: string }> {
  const pandoc = findPandoc()
  if (!pandoc) {
    return { error: '未找到 pandoc。请安装 pandoc 以支持 .doc 旧格式转换。' }
  }
  const outputDir = tmpdir()
  const baseName = basename(filePath).replace(/\.doc$/i, '')
  const tempOutput = join(outputDir, `${baseName}.docx`)
  if (existsSync(tempOutput)) {
    try { unlinkSync(tempOutput) } catch {}
  }
  return new Promise((resolve) => {
    const proc = spawn(pandoc, [filePath, '-o', tempOutput], {
      env: process.env,
      timeout: 60000,
    })
    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0 && existsSync(tempOutput)) {
        resolve({ outputPath: tempOutput })
      } else {
        resolve({ error: `pandoc 转换失败 (exit ${code}): ${stderr || '未知错误'}` })
      }
    })
    proc.on('error', (err) => {
      resolve({ error: `pandoc 启动失败: ${err.message}` })
    })
  })
}

export async function convertPptxToPdfWithPandoc(filePath: string): Promise<{ pdfPath?: string; error?: string }> {
  const pandoc = findPandoc()
  if (!pandoc) {
    return { error: '未找到 pandoc。请安装 pandoc 以支持 PPTX 转 PDF。' }
  }
  const outputDir = tmpdir()
  const baseName = basename(filePath).replace(/\.pptx$/i, '')
  const tempOutput = join(outputDir, `${baseName}.pdf`)
  if (existsSync(tempOutput)) {
    try { unlinkSync(tempOutput) } catch {}
  }
  return new Promise((resolve) => {
    const proc = spawn(pandoc, [filePath, '-o', tempOutput], {
      env: process.env,
      timeout: 60000,
    })
    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0 && existsSync(tempOutput)) {
        try {
          const pdfBuffer = readFileSync(tempOutput)
          const cachedPath = savePdfCache(filePath, pdfBuffer)
          unlinkSync(tempOutput)
          resolve({ pdfPath: cachedPath })
        } catch (err: any) {
          resolve({ error: `缓存保存失败: ${err.message}` })
        }
      } else {
        resolve({ error: `pandoc 转换失败 (exit ${code}): ${stderr || '未知错误'}` })
      }
    })
    proc.on('error', (err) => {
      resolve({ error: `pandoc 启动失败: ${err.message}` })
    })
  })
}

// ── Text extraction (mammoth) ──

async function extractDocxText(filePath: string): Promise<{ text?: string; markdown?: string; error?: string }> {
  try {
    const mammoth = await import('mammoth')
    const buffer = readFileSync(filePath)
    const rawResult = await mammoth.extractRawText({ buffer })
    const htmlResult = await mammoth.convertToHtml({ buffer })
    return {
      markdown: htmlResult.value || '',
      text: rawResult.value || '',
    }
  } catch (err: any) {
    // Fallback when mammoth chokes on unusual Unicode (xmlbuilder error)
    const fallback = await extractDocxRawText(filePath)
    if (fallback.error) {
      return { error: err.message || '提取文本失败' }
    }
    return { text: fallback.text, markdown: fallback.text }
  }
}

// ── Generate indexed HTML directly from document.xml ──
// This ensures data-p-index is 100% in sync with analyzeDocxStructure,
// avoiding the structural mismatch caused by mammoth's conversion.

async function convertDocxToIndexedHtml(filePath: string): Promise<{ html: string; error?: string }> {
  try {
    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const docXmlEntry = zip.file('word/document.xml')
    if (!docXmlEntry) {
      return { html: '', error: '未找到 word/document.xml' }
    }
    const xmlRaw = await docXmlEntry.async('string')

    const parser = new DOMParser()
    const doc = parser.parseFromString(sanitizeXmlString(xmlRaw), 'application/xml')

    const body = doc.getElementsByTagName('w:body')[0]
    if (!body) {
      return { html: '', error: '未找到 w:body' }
    }

    let pIndex = 0
    const parts: string[] = []

    function renderNode(el: Element): string {
      const tag = el.tagName

      if (tag === 'w:p') {
        const style = getParagraphStyle(el)
        const text = extractParagraphText(el)
        const escaped = escapeHtml(text)
        const idx = pIndex++

        if (style && (style.toLowerCase().includes('heading') || style.toLowerCase().includes('标题'))) {
          const levelMatch = style.match(/(\d+)/)
          const level = levelMatch ? levelMatch[1] : '1'
          const fontSize = level === '1' ? '28px' : level === '2' ? '24px' : level === '3' ? '20px' : '18px'
          return `<h${level} data-p-index="${idx}" style="margin: 0.6em 0; font-weight: bold; font-size: ${fontSize}; color: #1a1a1a;">${escaped || '&nbsp;'}</h${level}>`
        }
        return `<p data-p-index="${idx}" style="margin: 0.3em 0; text-indent: 2em;">${escaped || '&nbsp;'}</p>`
      }

      if (tag === 'w:tbl') {
        const rows: string[] = []
        const trElements = el.getElementsByTagName('w:tr')
        for (let i = 0; i < trElements.length; i++) {
          const cells: string[] = []
          const tcElements = trElements[i].getElementsByTagName('w:tc')
          for (let j = 0; j < tcElements.length; j++) {
            const cellParts: string[] = []
            for (const cellChild of Array.from(tcElements[j].childNodes)) {
              if (cellChild.nodeType !== 1) continue
              const result = renderNode(cellChild as unknown as Element)
              if (result) cellParts.push(result)
            }
            cells.push(`<td style="border: 1px solid #ccc; padding: 6px 10px;">${cellParts.join('') || '&nbsp;'}</td>`)
          }
          rows.push(`<tr style="background: ${i % 2 === 0 ? '#fff' : '#f8f9fa'};">${cells.join('')}</tr>`)
        }
        return `<table style="border-collapse: collapse; width: 100%; margin: 0.5em 0;">${rows.join('')}</table>`
      }

      // For other elements (w:r, w:tc, etc.), recursively process children
      let result = ''
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType !== 1) continue
        result += renderNode(child as unknown as Element)
      }
      return result
    }

    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType !== 1) continue
      const result = renderNode(child as unknown as Element)
      if (result) parts.push(result)
    }

    const html = `<div class="docx-indexed-content" style="font-family: 'Times New Roman', Georgia, serif; font-size: 16px; line-height: 1.7; color: #333;">${parts.join('')}</div>`
    return { html }
  } catch (err: any) {
    return { html: '', error: err.message || '转换失败' }
  }
}

function getParagraphStyle(pElement: Element): string | null {
  const pPr = pElement.getElementsByTagName('w:pPr')[0]
  if (!pPr) return null
  const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
  if (!pStyle) return null
  return pStyle.getAttribute('w:val')
}

function extractParagraphText(pElement: Element): string {
  const texts: string[] = []
  // Note: getElementsByTagName is recursive, which is what we want for nested runs
  const tElements = pElement.getElementsByTagName('w:t')
  for (let i = 0; i < tElements.length; i++) {
    texts.push(tElements[i].textContent || '')
  }
  // Also extract OMML math text so formulas show up in fallback HTML preview
  const mTElements = pElement.getElementsByTagName('m:t')
  for (let i = 0; i < mTElements.length; i++) {
    texts.push(mTElements[i].textContent || '')
  }
  return texts.join('')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Unpack / Pack (delegates to src/agent/document for framework-agnostic core) ──

const unpackDocx = unpackDocxCore

async function packDocx(inputDir: string, outputPath?: string): Promise<{ success: boolean; error?: string }> {
  // Resolve the final output so we can record undo history before delegating.
  let finalOutputPath = outputPath
  if (!finalOutputPath) {
    const sourceMarker = join(inputDir, '.source')
    if (existsSync(sourceMarker)) {
      finalOutputPath = readFileSync(sourceMarker, 'utf-8').trim()
    }
  }
  if (finalOutputPath && existsSync(finalOutputPath)) {
    try {
      const currentBuffer = readFileSync(finalOutputPath)
      const db = getDb()
      if (db) db.pushFileHistory(finalOutputPath, currentBuffer.toString('base64'))
    } catch {}
  }
  return packDocxCore(inputDir, outputPath)
}

// ── XML utilities (delegates to agent/document) ──

const prettyPrintXml = prettyPrintXmlCore
const autoRepairXml = autoRepairXmlCore


// ── Create from Markdown (docx-js) ──

async function createFromMarkdown(payload: { outputPath: string; title?: string; content: string }): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const docx = await import('docx')
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
      LevelFormat, Table, TableRow, TableCell, BorderStyle, WidthType,
      ShadingType, PageBreak,
    } = docx

    const children: any[] = []

    if (payload.title) {
      children.push(
        new Paragraph({
          text: payload.title,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
        })
      )
    }

    const lines = payload.content.split('\n')
    let i = 0
    let inTable = false
    let tableRows: string[][] = []
    let tableHeaders: string[] = []

    const parseInline = (text: string) => {
      const runs: any[] = []
      const regex = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
      let lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
        }
        if (match[2]) {
          runs.push(new TextRun({ text: match[2], bold: true }))
        } else if (match[4]) {
          runs.push(new TextRun({ text: match[4], italics: true }))
        } else if (match[5]) {
          runs.push(new TextRun({ text: match[5], font: 'Courier New' }))
        } else if (match[6] && match[7]) {
          runs.push(new TextRun({ text: match[6], style: 'Hyperlink' }))
        }
        lastIndex = regex.lastIndex
      }
      if (lastIndex < text.length) {
        runs.push(new TextRun({ text: text.slice(lastIndex) }))
      }
      if (runs.length === 0) {
        runs.push(new TextRun({ text }))
      }
      return runs
    }

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        if (inTable) { inTable = false; tableRows = []; tableHeaders = []; }
        children.push(new Paragraph({ children: [new PageBreak()] }))
        i++; continue
      }

      if (trimmed.startsWith('|')) {
        if (!inTable) {
          inTable = true
          tableHeaders = trimmed.split('|').map((s) => s.trim()).filter((s) => s)
          tableRows = []
        } else if (trimmed.match(/^\|?\s*[-:]+\s*\|/)) {
          // separator
        } else {
          const cells = trimmed.split('|').map((s) => s.trim()).filter((s) => s)
          if (cells.length > 0) tableRows.push(cells)
        }
        i++
        if (i >= lines.length || !lines[i].trim().startsWith('|')) {
          inTable = false
          const numCols = Math.max(tableHeaders.length, ...tableRows.map((r) => r.length))
          const colWidth = Math.floor(9360 / numCols)
          const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
          const borders = { top: border, bottom: border, left: border, right: border }

          const rows: any[] = []
          if (tableHeaders.length > 0) {
            rows.push(
              new TableRow({
                children: tableHeaders.map((h) =>
                  new TableCell({
                    borders,
                    width: { size: colWidth, type: WidthType.DXA },
                    shading: { fill: 'D5E8F0', type: ShadingType.CLEAR },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ children: parseInline(h) })],
                  })
                ),
              })
            )
          }
          for (const cells of tableRows) {
            rows.push(
              new TableRow({
                children: cells.map((c) =>
                  new TableCell({
                    borders,
                    width: { size: colWidth, type: WidthType.DXA },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ children: parseInline(c) })],
                  })
                ),
              })
            )
          }

          children.push(
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: Array(numCols).fill(colWidth),
              rows,
            })
          )
          tableHeaders = []; tableRows = []
        }
        continue
      }

      inTable = false

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        const level = headingMatch[1].length
        const text = headingMatch[2]
        const levelMap: Record<number, any> = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6 }
        children.push(new Paragraph({ heading: levelMap[level] || HeadingLevel.HEADING_1, children: parseInline(text) }))
        i++; continue
      }

      const ulMatch = trimmed.match(/^[\*\-\+]\s+(.+)$/)
      if (ulMatch) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(ulMatch[1]) }))
        i++; continue
      }

      const olMatch = trimmed.match(/^\d+\.\s+(.+)$/)
      if (olMatch) {
        children.push(new Paragraph({ numbering: { reference: 'default-numbering', level: 0 }, children: parseInline(olMatch[1]) }))
        i++; continue
      }

      if (trimmed.startsWith('>')) {
        const text = trimmed.slice(1).trim()
        children.push(new Paragraph({ children: parseInline(text), indent: { left: 720 }, spacing: { before: 120, after: 120 } }))
        i++; continue
      }

      if (trimmed === '') { i++; continue }

      children.push(new Paragraph({ children: parseInline(trimmed) }))
      i++
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 24 },
          },
        },
        paragraphStyles: [
          {
            id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 32, bold: true, font: 'Arial' },
            paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
          },
          {
            id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 28, bold: true, font: 'Arial' },
            paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 },
          },
          {
            id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 26, bold: true, font: 'Arial' },
            paragraph: { spacing: { before: 160, after: 160 }, outlineLevel: 2 },
          },
        ],
      },
      numbering: {
        config: [
          {
            reference: 'default-numbering',
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children,
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    writeFileSync(payload.outputPath, buffer)
    return { success: true, path: payload.outputPath }
  } catch (err: any) {
    return { success: false, error: err.message || '创建 Word 文档失败' }
  }
}

// ── Analyze document structure ──

export interface DocxStructureItem {
  index: number
  type: 'paragraph' | 'table' | 'image' | 'other'
  summary: string
  fullText: string
  style?: string
  lineStart: number
  lineEnd: number
}

async function analyzeDocxStructure(filePath: string): Promise<{ items: DocxStructureItem[]; error?: string }> {
  try {
    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const docXmlEntry = zip.file('word/document.xml')
    if (!docXmlEntry) {
      return { items: [], error: '文档中未找到 word/document.xml' }
    }

    const xmlRaw = await docXmlEntry.async('string')
    const parser = new DOMParser()
    const doc = parser.parseFromString(sanitizeXmlString(xmlRaw), 'application/xml')
    const body = doc.getElementsByTagName('w:body')[0]
    if (!body) {
      return { items: [], error: '未找到 w:body' }
    }

    const items: DocxStructureItem[] = []
    let pIndex = 0

    function processNode(node: any) {
      if (node.nodeType !== 1) return
      const el = node as Element

      if (el.tagName === 'w:p') {
        const pPr = el.getElementsByTagName('w:pPr')[0]
        let style: string | undefined
        if (pPr) {
          const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
          if (pStyle) style = pStyle.getAttribute('w:val') || undefined
        }

        const texts: string[] = []
        const tElements = el.getElementsByTagName('w:t')
        for (let i = 0; i < tElements.length; i++) {
          texts.push(tElements[i].textContent || '')
        }
        const fullText = texts.join('').trim()

        let type: DocxStructureItem['type'] = 'paragraph'
        if (style) {
          const styleLower = style.toLowerCase()
          if (styleLower.includes('heading') || styleLower.includes('标题')) {
            type = 'other'
          }
        }

        items.push({
          index: pIndex++,
          type,
          summary: fullText.slice(0, 80) || '(空段落)',
          fullText,
          style,
          lineStart: 0,
          lineEnd: 0,
        })
      } else {
        for (const child of Array.from(el.childNodes)) {
          processNode(child)
        }
      }
    }

    for (const child of Array.from(body.childNodes)) {
      processNode(child)
    }

    return { items }
  } catch (err: any) {
    return { items: [], error: err.message || '解析文档结构失败' }
  }
}

// ── Replace paragraph text (delegates to agent/document, with db-backed undo hook) ──

export async function replaceParagraphText(
  filePath: string,
  paragraphIndex: number,
  newText: string,
  tempBaseDir?: string,
): Promise<{ success: boolean; error?: string }> {
  return replaceParagraphTextCore(filePath, paragraphIndex, newText, {
    tempBaseDir,
    beforeWrite: (originalBuffer) => {
      const db = getDb()
      if (db) db.pushFileHistory(filePath, originalBuffer.toString('base64'))
    },
  })
}

// ── Add paragraph (delegates to agent/document, with db-backed undo hook) ──

export async function addParagraph(
  filePath: string,
  paragraphIndex: number,
  text: string,
  tempBaseDir?: string,
): Promise<{ success: boolean; error?: string }> {
  return addParagraphTextCore(filePath, paragraphIndex, text, {
    tempBaseDir,
    beforeWrite: (originalBuffer) => {
      const db = getDb()
      if (db) db.pushFileHistory(filePath, originalBuffer.toString('base64'))
    },
  })
}

// ── Delete paragraph (delegates to agent/document, with db-backed undo hook) ──

export async function deleteParagraph(
  filePath: string,
  paragraphIndex: number,
  tempBaseDir?: string,
): Promise<{ success: boolean; error?: string }> {
  return deleteParagraphCore(filePath, paragraphIndex, {
    tempBaseDir,
    beforeWrite: (originalBuffer) => {
      const db = getDb()
      if (db) db.pushFileHistory(filePath, originalBuffer.toString('base64'))
    },
  })
}

// ── Modify paragraph format (delegates to agent/document, with db-backed undo hook) ──

export async function modifyParagraphFormat(
  filePath: string,
  paragraphIndex: number,
  changes: import('../agent/document').FormatChange[],
  tempBaseDir?: string,
): Promise<{ success: boolean; error?: string }> {
  return modifyParagraphFormatCore(filePath, paragraphIndex, changes, {
    tempBaseDir,
    beforeWrite: (originalBuffer) => {
      const db = getDb()
      if (db) db.pushFileHistory(filePath, originalBuffer.toString('base64'))
    },
  })
}

export async function modifyGlobalFormat(
  filePath: string,
  changes: import('../agent/document').FormatChange[],
  tempBaseDir?: string,
): Promise<{ success: boolean; error?: string }> {
  return modifyGlobalFormatCore(filePath, changes, {
    tempBaseDir,
    beforeWrite: (originalBuffer) => {
      const db = getDb()
      if (db) db.pushFileHistory(filePath, originalBuffer.toString('base64'))
    },
  })
}

// ── Undo docx change ──

function undoDocxChange(filePath: string): { success: boolean; error?: string; version?: number } {
  try {
    const db = getDb()
    if (!db) {
      return { success: false, error: '数据库未初始化' }
    }
    const history = db.popFileHistory(filePath)
    if (!history) {
      return { success: false, error: '没有可撤销的历史' }
    }
    const buffer = Buffer.from(history.content, 'base64')
    writeFileSync(filePath, buffer)
    return { success: true, version: history.version }
  } catch (err: any) {
    return { success: false, error: err.message || '撤销失败' }
  }
}

// ── External edit watcher ──

const externalWatchers = new Map<string, { stop: () => void }>()

export function watchExternalEdits(filePath: string, onChanged: () => void): string {
  // Stop existing watcher for this file
  unwatchExternalEdits(filePath)

  let lastMtime = 0
  try {
    const stats = statSync(filePath)
    lastMtime = stats.mtimeMs
  } catch {}

  const interval = setInterval(() => {
    try {
      const stats = statSync(filePath)
      if (stats.mtimeMs > lastMtime) {
        lastMtime = stats.mtimeMs
        onChanged()
      }
    } catch {
      // File may have been deleted
    }
  }, 2000)

  const watcherId = `ext-watch-${filePath}`
  externalWatchers.set(filePath, {
    stop: () => clearInterval(interval),
  })
  return watcherId
}

export function unwatchExternalEdits(filePath: string): void {
  const watcher = externalWatchers.get(filePath)
  if (watcher) {
    watcher.stop()
    externalWatchers.delete(filePath)
  }
}

// ── IPC Handlers ──

export function registerWordHandlers() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcMain } = require('electron')

  ipcMain.handle('word:convertDocToDocx', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    const result = await convertDocToDocxWithPandoc(filePath)
    return { outputPath: result.outputPath, error: result.error }
  })

  ipcMain.handle('word:extractText', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return extractDocxText(filePath)
  })

  ipcMain.handle('word:convertToIndexedHtml', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return convertDocxToIndexedHtml(filePath)
  })

  ipcMain.handle('word:unpack', async (_event: Electron.IpcMainInvokeEvent, filePath: string, outputDir?: string) => {
    const destDir = outputDir || join(tmpdir(), `docx-unpack-${basename(filePath, '.docx')}-${Date.now()}`)
    const result = await unpackDocx(filePath, destDir)
    return { ...result, outputDir: destDir }
  })

  ipcMain.handle('word:pack', async (_event: Electron.IpcMainInvokeEvent, inputDir: string, outputPath?: string) => {
    return packDocx(inputDir, outputPath)
  })

  ipcMain.handle('word:createFromMarkdown', async (_event: Electron.IpcMainInvokeEvent, payload: { outputPath: string; title?: string; content: string }) => {
    return createFromMarkdown(payload)
  })

  ipcMain.handle('word:analyzeStructure', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return analyzeDocxStructure(filePath)
  })

  ipcMain.handle('word:convertToPdf', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    try {
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (ext === 'docx') {
        return convertWithSoffice(filePath, 'pdf')
      }
      if (ext === 'doc') {
        const docxResult = await convertWithSoffice(filePath, 'docx')
        if (docxResult.error || !docxResult.pdfPath) {
          return { error: docxResult.error || '.doc 转换失败' }
        }
        const pdfResult = await convertWithSoffice(docxResult.pdfPath!, 'pdf')
        try { unlinkSync(docxResult.pdfPath!) } catch {}
        return pdfResult
      }
      return { error: `不支持的 Word 格式: .${ext}` }
    } catch (err: any) {
      return { error: err.message || '转换失败' }
    }
  })

  ipcMain.handle('word:openWithLibreOffice', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return openWithLibreOffice(filePath)
  })

  ipcMain.handle('word:openExternally', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return openWithSystemDefault(filePath)
  })

  ipcMain.handle('word:watchExternal', async (event: Electron.IpcMainInvokeEvent, filePath: string) => {
    const sender = event.sender
    watchExternalEdits(filePath, () => {
      if (!sender.isDestroyed()) {
        sender.send('word:external-changed', filePath)
      }
    })
    return { success: true }
  })

  ipcMain.handle('word:unwatchExternal', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    unwatchExternalEdits(filePath)
    return { success: true }
  })

  ipcMain.handle('word:replaceParagraph', async (_event: Electron.IpcMainInvokeEvent, filePath: string, paragraphIndex: number, newText: string) => {
    return replaceParagraphText(filePath, paragraphIndex, newText)
  })

  ipcMain.handle('word:addParagraph', async (_event: Electron.IpcMainInvokeEvent, filePath: string, paragraphIndex: number, text: string) => {
    return addParagraph(filePath, paragraphIndex, text)
  })

  ipcMain.handle('word:deleteParagraph', async (_event: Electron.IpcMainInvokeEvent, filePath: string, paragraphIndex: number) => {
    return deleteParagraph(filePath, paragraphIndex)
  })

  ipcMain.handle('word:modifyFormat', async (_event: Electron.IpcMainInvokeEvent, filePath: string, target: { type: 'paragraph'; paragraphIndex: number } | { type: 'global' }, changes: FormatChange[]) => {
    if (target.type === 'paragraph') {
      return modifyParagraphFormat(filePath, target.paragraphIndex, changes)
    }
    return modifyGlobalFormat(filePath, changes)
  })

  ipcMain.handle('word:undoChange', async (_event: Electron.IpcMainInvokeEvent, filePath: string) => {
    return undoDocxChange(filePath)
  })

  ipcMain.handle('word:getPandocInfo', async () => {
    return getPandocInfo()
  })

  ipcMain.handle('word:verifyPandoc', async (_event: Electron.IpcMainInvokeEvent, customPath: string) => {
    return verifyPandocPath(customPath)
  })
}
