/**
 * Framework-agnostic helpers for editing .docx (Word) paragraph text.
 *
 * These functions only depend on the filesystem, JSZip, and string
 * manipulation — no Electron, no SQLite. The Electron main process and
 * agent tools both consume this module so they share one implementation.
 *
 * The legacy host (src/main/word-office.ts) wraps `replaceParagraphText`
 * with database-backed undo history. Agent tools that operate inside
 * a sandbox or without a renderer can call this directly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { dirname, join, basename } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

/** Strip XML 1.0 illegal characters.
 *  Valid: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 *  Illegal control chars + UTF-16 surrogates + #xFFFE/#xFFFF
 */
export function sanitizeXmlString(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\uFFFE/g, '')
    .replace(/\uFFFF/g, '')
}

export interface UnpackResult {
  success: boolean
  error?: string
  files: string[]
  originalPath?: string
}

export interface PackResult {
  success: boolean
  error?: string
}

export interface ReplaceParagraphOptions {
  /** Override the temp directory root used during unpack/repack. */
  tempBaseDir?: string
  /** Called with the original file buffer right before the file is overwritten,
   *  letting hosts persist undo history. Failures throw. */
  beforeWrite?: (originalBuffer: Buffer) => void
}

/**
 * Pretty-prints a Word XML document with simple newlines + indentation.
 * Inline elements (<w:r>, <w:t>, etc.) are kept on a single line so
 * paragraph indices remain stable.
 */
export function prettyPrintXml(xml: string): string {
  let formatted = ''
  let indent = 0
  const tab = '  '

  xml = xml.replace(/>\s+</g, '><')

  const tokens = xml.split(/(<\/?[^>]+>)/g).filter((s) => s.length > 0)

  // Tags whose contents should stay inline (no extra indentation).
  const INLINE_TAGS = new Set([
    '<w:tab/>', '<w:br/>', '<w:cr/>', '<w:lastRenderedPageBreak/>',
    '<w:footnoteRef/>', '<w:endnoteRef/>', '<w:separator/>',
    '<w:continuationSeparator/>', '<w:pgNum/>', '<w:noProof/>',
    '<w:dirty/>', '<w:webHidden/>', '<w:vanish/>', '<w:specVanish/>',
  ])
  const INLINE_PREFIXES = [
    '<w:bookmarkStart', '<w:bookmarkEnd', '<w:commentRangeStart',
    '<w:commentRangeEnd', '<w:commentReference', '<w:del', '<w:ins',
    '<w:moveFrom', '<w:moveTo', '<w:customXml', '<w:sdt', '<w:sdtEnd',
    '<w:sdtContent', '<w:sdtContentEnd', '<w:tblGrid', '<w:gridCol',
    '<w:tblLook', '<w:tblBorders', '<w:tblCellMar', '<w:tblInd',
    '<w:tblW', '<w:tblLayout', '<w:jc', '<w:spacing', '<w:ind',
    '<w:pBdr', '<w:shd', '<w:rPr', '<w:pPr', '<w:sectPr', '<w:hdr',
    '<w:ftr', '<w:footnote', '<w:endnote', '<w:comment', '<w:document',
    '<w:body', '<w:p>', '<w:r>', '<w:t>', '<w:tbl>', '<w:tr>', '<w:tc>',
    '<w:hyperlink',
  ]

  function isInline(token: string): boolean {
    if (INLINE_TAGS.has(token)) return true
    return INLINE_PREFIXES.some((prefix) => token.startsWith(prefix))
  }

  for (const token of tokens) {
    if (token.startsWith('<?')) {
      formatted += token + '\n'
      continue
    }
    if (token.startsWith('</')) {
      indent = Math.max(0, indent - 1)
      formatted += tab.repeat(indent) + token + '\n'
      continue
    }
    if (token.startsWith('<') && !token.endsWith('/>') && !isInline(token)) {
      formatted += tab.repeat(indent) + token + '\n'
      indent++
      continue
    }
    formatted += tab.repeat(indent) + token + '\n'
  }

  return formatted.trim()
}

/** Repairs Word XML quirks that LibreOffice/Word reject after editing. */
export function autoRepairXml(xml: string): string {
  xml = xml.replace(/w14:durableId="(\d+)"/g, (match, id) => {
    const num = parseInt(id, 10)
    if (num >= 0x7FFFFFFF) {
      return `w14:durableId="${Math.floor(Math.random() * 0x7FFFFFFE)}"`
    }
    return match
  })

  xml = xml.replace(/<w:t>([^<]*[\s][^<]*)<\/w:t>/g, (match, content) => {
    if (match.includes('xml:space=')) return match
    return `<w:t xml:space="preserve">${content}</w:t>`
  })

  xml = xml.replace(/>\s+</g, '><')
  return xml
}

/** Unpacks a .docx file (zip) to a directory, pretty-printing XML entries. */
export async function unpackDocx(filePath: string, outputDir: string): Promise<UnpackResult> {
  try {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const files: string[] = []

    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      const destPath = join(outputDir, relPath)
      mkdirSync(dirname(destPath), { recursive: true })

      if (relPath.endsWith('.xml') || relPath.endsWith('.rels')) {
        try {
          // Use JSZip's built-in encoding detection (handles UTF-8 BOM, UTF-16, etc.)
          const xmlStr = await entry.async('string')
          const pretty = prettyPrintXml(sanitizeXmlString(xmlStr))
          writeFileSync(destPath, pretty, 'utf-8')
        } catch {
          const content = await entry.async('nodebuffer')
          writeFileSync(destPath, content)
        }
      } else {
        const content = await entry.async('nodebuffer')
        writeFileSync(destPath, content)
      }

      files.push(relPath)
    }

    writeFileSync(join(outputDir, '.source'), filePath, 'utf-8')

    return { success: true, files, originalPath: filePath }
  } catch (err: any) {
    return { success: false, error: err.message || 'unpack failed', files: [] }
  }
}

/** Re-zips a directory back into a .docx file, applying autoRepairXml. */
export async function packDocx(inputDir: string, outputPath?: string): Promise<PackResult> {
  try {
    let finalOutputPath = outputPath
    if (!finalOutputPath) {
      const sourceMarker = join(inputDir, '.source')
      if (existsSync(sourceMarker)) {
        finalOutputPath = readFileSync(sourceMarker, 'utf-8').trim()
      }
    }
    if (!finalOutputPath) {
      return { success: false, error: 'no output path specified' }
    }

    const zip = new JSZip()

    function addFiles(dir: string, prefix = ''): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (entry.name === '.source') continue
          addFiles(fullPath, zipPath)
        } else {
          if (entry.name === '.source' && !prefix) continue

          let content = readFileSync(fullPath)
          if (entry.name.endsWith('.xml') || entry.name.endsWith('.rels')) {
            const xmlStr = content.toString('utf-8')
            content = Buffer.from(autoRepairXml(xmlStr), 'utf-8')
          }
          zip.file(zipPath, content)
        }
      }
    }

    addFiles(inputDir)

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    writeFileSync(finalOutputPath, buffer)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'pack failed' }
  }
}

/**
 * Replaces the text of the Nth paragraph in a .docx file while preserving
 * the paragraph's existing formatting (style, run properties).
 */
export async function replaceParagraphText(
  filePath: string,
  paragraphIndex: number,
  newText: string,
  options: ReplaceParagraphOptions = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const originalBuffer = readFileSync(filePath)
    if (options.beforeWrite) {
      try {
        options.beforeWrite(originalBuffer)
      } catch (hookErr: any) {
        return { success: false, error: 'history hook failed: ' + (hookErr?.message ?? hookErr) }
      }
    }

    const tempRoot = options.tempBaseDir
      ? join(options.tempBaseDir, '.note_agent', 'temp')
      : tmpdir()
    const tempDir = join(tempRoot, `docx-replace-${basename(filePath, '.docx')}-${Date.now()}`)
    const unpackResult = await unpackDocx(filePath, tempDir)
    if (!unpackResult.success) {
      return { success: false, error: unpackResult.error || 'unpack failed' }
    }

    const docXmlPath = join(tempDir, 'word', 'document.xml')
    if (!existsSync(docXmlPath)) {
      return { success: false, error: 'word/document.xml not found' }
    }
    let xmlContent = sanitizeXmlString(readFileSync(docXmlPath, 'utf-8'))

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'application/xml')

    const body = doc.getElementsByTagName('w:body')[0]
    if (!body) {
      return { success: false, error: 'w:body not found' }
    }
    const paragraphs = body.getElementsByTagName('w:p')
    if (paragraphIndex < 0 || paragraphIndex >= paragraphs.length) {
      return { success: false, error: `paragraph ${paragraphIndex + 1} not found (total ${paragraphs.length})` }
    }

    const oldParagraph = paragraphs[paragraphIndex]

    // Cache properties BEFORE clearing so we can preserve formatting.
    const pPrList = oldParagraph.getElementsByTagName('w:pPr')
    const pPr = pPrList.length > 0 ? pPrList[0] : null

    const runs = oldParagraph.getElementsByTagName('w:r')
    const rPrList = runs.length > 0 ? runs[0].getElementsByTagName('w:rPr') : []
    const rPr = rPrList.length > 0 ? rPrList[0] : null

    // Remove all existing child nodes (runs, properties, bookmarks, etc.)
    while (oldParagraph.firstChild) {
      oldParagraph.removeChild(oldParagraph.firstChild)
    }

    // Re-attach paragraph properties if they existed
    if (pPr) {
      oldParagraph.appendChild(pPr.cloneNode(true))
    }

    const newRun = doc.createElement('w:r')
    if (rPr) {
      newRun.appendChild(rPr.cloneNode(true))
    }

    const newTextNode = doc.createElement('w:t')
    const sanitizedNewText = sanitizeXmlString(newText)
    if (/^\s+|\s+$/.test(sanitizedNewText)) {
      newTextNode.setAttribute('xml:space', 'preserve')
    }
    newTextNode.textContent = sanitizedNewText
    newRun.appendChild(newTextNode)
    oldParagraph.appendChild(newRun)


    const serializer = new XMLSerializer()
    xmlContent = serializer.serializeToString(doc)
    xmlContent = autoRepairXml(xmlContent)
    writeFileSync(docXmlPath, xmlContent, 'utf-8')

    const packResult = await packDocx(tempDir, filePath)
    if (!packResult.success) {
      return { success: false, error: packResult.error || 'pack failed' }
    }

    try { rmSync(tempDir, { recursive: true }) } catch {}

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'replace paragraph failed' }
  }
}

/**
 * Fallback text extraction for .docx when mammoth fails (e.g. due to
 * xmlbuilder "Invalid character" on documents with unusual Unicode).
 */
export async function extractDocxRawText(filePath: string): Promise<{ text: string; error?: string }> {
  try {
    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const docXmlEntry = zip.file('word/document.xml')
    if (!docXmlEntry) {
      return { text: '', error: 'word/document.xml not found' }
    }
    const xmlRaw = await docXmlEntry.async('string')
    const parser = new DOMParser()
    const doc = parser.parseFromString(sanitizeXmlString(xmlRaw), 'application/xml')
    const texts: string[] = []
    function walk(node: any) {
      if (node.nodeName === 'w:t') {
        texts.push(node.textContent || '')
      }
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i])
      }
    }
    walk(doc.documentElement)
    return { text: texts.join('') }
  } catch (err: any) {
    return { text: '', error: err.message || 'extraction failed' }
  }
}
