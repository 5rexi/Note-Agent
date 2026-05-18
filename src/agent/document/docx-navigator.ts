/**
 * OfficeCLI-inspired document navigator for .docx files.
 *
 * Provides path-based addressing (`/body/p[1]/r[1]`), CSS-like querying,
 * and structured JSON output over our existing JSZip + @xmldom stack.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, basename, dirname } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import {
  sanitizeXmlString,
  autoRepairXml,
  unpackDocx,
  packDocx,
} from './word-paragraph'
import { safePath } from '../utils/fs-guard'

// ── Types ──

export interface DocxNavError {
  code: 'not_found' | 'invalid_path' | 'invalid_value' | 'unsupported_property'
    | 'file_not_found' | 'parse_error' | 'out_of_range'
  message: string
  suggestion?: string
  validRange?: string
}

export interface DocxElement {
  tag: string
  path: string
  index: number // 1-based sibling index
  text?: string
  attributes: Record<string, string>
  children?: DocxElement[]
}

export interface DocxDocument {
  filePath: string
  tempDir: string
  document: Document
  body: Element
  docXmlPath: string
  isDirty: boolean
}

// ── Tag name mapping (short → full) ──
const TAG_MAP: Record<string, string> = {
  body: 'w:body',
  p: 'w:p',
  r: 'w:r',
  t: 'w:t',
  tbl: 'w:tbl',
  tr: 'w:tr',
  tc: 'w:tc',
  pPr: 'w:pPr',
  rPr: 'w:rPr',
  sectPr: 'w:sectPr',
  hyperlink: 'w:hyperlink',
  bookmarkStart: 'w:bookmarkStart',
  bookmarkEnd: 'w:bookmarkEnd',
}

function resolveTag(shortName: string): string {
  return TAG_MAP[shortName] || shortName
}

function shortTag(fullName: string): string {
  for (const [short, full] of Object.entries(TAG_MAP)) {
    if (full === fullName) return short
  }
  return fullName
}

// ── Path Parser ──

interface PathSegment {
  tag: string // full tag name, e.g. 'w:p'
  shortTag: string // short name, e.g. 'p'
  index: number // 1-based; -1 means "last"
}

function parsePath(path: string): { segments: PathSegment[]; error?: DocxNavError } {
  if (!path || path === '/') {
    return { segments: [] }
  }

  const segments: PathSegment[] = []
  const parts = path.split('/').filter(Boolean)

  for (const part of parts) {
    const match = part.match(/^([a-zA-Z][a-zA-Z0-9]*)(?:\[(\d+|last)\])?$/)
    if (!match) {
      return {
        segments: [],
        error: {
          code: 'invalid_path',
          message: `Invalid path segment: "${part}"`,
          suggestion: 'Use format: elementName[index], e.g. /body/p[1]/r[1]',
        },
      }
    }
    const shortName = match[1]
    const fullName = resolveTag(shortName)
    const indexStr = match[2]
    const index = indexStr === 'last' ? -1 : (indexStr ? parseInt(indexStr, 10) : 1)
    if (index !== -1 && (isNaN(index) || index < 1)) {
      return {
        segments: [],
        error: {
          code: 'invalid_path',
          message: `Index must be >= 1 or 'last', got: ${indexStr}`,
        },
      }
    }
    segments.push({ tag: fullName, shortTag: shortName, index })
  }

  return { segments }
}

function buildPath(segments: PathSegment[]): string {
  return '/' + segments.map((s) => `${s.shortTag}[${s.index}]`).join('/')
}

// ── Document Loader ──

export async function openDocx(
  filePath: string,
  tempBaseDir?: string,
): Promise<{ doc: DocxDocument; error?: DocxNavError }> {
  if (tempBaseDir) {
    try {
      filePath = safePath(filePath, tempBaseDir)
    } catch {
      // safePath failed — filePath may already be absolute outside workspace
      // (e.g. system templates). Continue with original path.
    }
  }
  if (!existsSync(filePath)) {
    return {
      doc: null as any,
      error: { code: 'file_not_found', message: `File not found: ${filePath}` },
    }
  }

  const tempRoot = tempBaseDir
    ? join(tempBaseDir, '.note_agent', 'temp')
    : tmpdir()
  const tempDir = join(tempRoot, `docx-nav-${basename(filePath, '.docx')}-${Date.now()}`)

  const unpackResult = await unpackDocx(filePath, tempDir)
  if (!unpackResult.success) {
    return {
      doc: null as any,
      error: { code: 'parse_error', message: unpackResult.error || 'Failed to unpack docx' },
    }
  }

  const docXmlPath = join(tempDir, 'word', 'document.xml')
  if (!existsSync(docXmlPath)) {
    rmSync(tempDir, { recursive: true, force: true })
    return {
      doc: null as any,
      error: { code: 'parse_error', message: 'word/document.xml not found' },
    }
  }

  const xmlContent = sanitizeXmlString(readFileSync(docXmlPath, 'utf-8'))
  const parser = new DOMParser()
  const document = parser.parseFromString(xmlContent, 'application/xml')
  const body = document.getElementsByTagName('w:body')[0]

  if (!body) {
    rmSync(tempDir, { recursive: true, force: true })
    return {
      doc: null as any,
      error: { code: 'parse_error', message: 'w:body not found in document.xml' },
    }
  }

  return {
    doc: {
      filePath,
      tempDir,
      document: document as any,
      body: body as any,
      docXmlPath,
      isDirty: false,
    },
  }
}

export async function saveDocx(
  docHandle: DocxDocument,
  outputPath?: string,
): Promise<{ success: boolean; error?: DocxNavError }> {
  if (!docHandle.isDirty) {
    return { success: true }
  }

  const serializer = new XMLSerializer()
  let xmlContent = serializer.serializeToString(docHandle.document as any)
  xmlContent = autoRepairXml(xmlContent)
  writeFileSync(docHandle.docXmlPath, xmlContent, 'utf-8')

  const packResult = await packDocx(docHandle.tempDir, outputPath || docHandle.filePath)
  if (!packResult.success) {
    return {
      success: false,
      error: { code: 'parse_error', message: packResult.error || 'Failed to pack docx' },
    }
  }

  docHandle.isDirty = false
  return { success: true }
}

export function closeDocx(docHandle: DocxDocument): void {
  try { rmSync(docHandle.tempDir, { recursive: true, force: true }) } catch {}
}

// ── Path Resolver ──

export function resolvePath(
  docHandle: DocxDocument,
  path: string,
): { element: Element | null; parent: Element | null; segments: PathSegment[]; error?: DocxNavError } {
  const parsed = parsePath(path)
  if (parsed.error) {
    return { element: null, parent: null, segments: [], error: parsed.error }
  }

  const { segments } = parsed
  if (segments.length === 0) {
    return { element: docHandle.body, parent: docHandle.body.parentNode as Element, segments: [] }
  }

  // First segment must resolve to body (or document root)
  let current: Element = docHandle.body
  let parent: Element = docHandle.body.parentNode as Element

  // Handle /body as first segment
  if (segments[0].tag === 'w:body') {
    if (segments.length === 1) {
      return { element: current, parent, segments }
    }
    // Continue with remaining segments
    return walkChildren(current, segments.slice(1))
  }

  // Otherwise, assume starting from body
  return walkChildren(current, segments)
}

function walkChildren(
  startElement: Element,
  segments: PathSegment[],
): { element: Element | null; parent: Element | null; segments: PathSegment[]; error?: DocxNavError } {
  let current: Element = startElement
  let parent: Element = startElement.parentNode as Element

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const children = getDirectChildrenByTag(current, seg.tag)

    if (children.length === 0) {
      return {
        element: null,
        parent: current,
        segments,
        error: {
          code: 'not_found',
          message: `No "${seg.shortTag}" elements found in ${buildPath(segments.slice(0, i))}`,
          suggestion: `Available child elements: ${listChildTags(current)}`,
        },
      }
    }

    const idx = seg.index === -1 ? children.length - 1 : seg.index - 1
    if (idx < 0 || idx >= children.length) {
      return {
        element: null,
        parent: current,
        segments,
        error: {
          code: 'out_of_range',
          message: `${seg.shortTag}[${seg.index}] not found (total: ${children.length})`,
          validRange: `1-${children.length}`,
        },
      }
    }

    parent = current
    current = children[idx]
  }

  return { element: current, parent, segments }
}

/** Get only DIRECT children with matching tag (not recursive). */
function getDirectChildrenByTag(parent: Element, tagName: string): Element[] {
  const result: Element[] = []
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      result.push(child as Element)
    }
  }
  return result
}

function listChildTags(parent: Element): string {
  const tags = new Set<string>()
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      tags.add(shortTag((child as Element).tagName))
    }
  }
  return Array.from(tags).join(', ') || '(none)'
}

// ── Element Introspection ──

export function getElementInfo(element: Element, path: string, includeChildren = false): DocxElement {
  const attributes: Record<string, string> = {}
  if (element.attributes) {
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i]
      attributes[attr.name] = attr.value
    }
  }

  const info: DocxElement = {
    tag: shortTag(element.tagName),
    path,
    index: getSiblingIndex(element),
    text: extractElementText(element),
    attributes,
  }

  if (includeChildren) {
    const childInfos: DocxElement[] = []
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) {
        const childEl = child as Element
        const childPath = `${path}/${shortTag(childEl.tagName)}[${getSiblingIndex(childEl)}]`
        childInfos.push(getElementInfo(childEl, childPath, false))
      }
    }
    info.children = childInfos
  }

  return info
}

function getSiblingIndex(element: Element): number {
  const parent = element.parentNode as Element
  if (!parent) return 1
  let idx = 1
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      if (child === element) return idx
      if ((child as Element).tagName === element.tagName) idx++
    }
  }
  return 1
}

function extractElementText(element: Element): string {
  const texts: string[] = []
  function walk(node: Node) {
    if (node.nodeType === 3) {
      texts.push(node.textContent || '')
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child)
    }
  }
  walk(element)
  return texts.join('').trim()
}

// ── Query Engine (CSS-like selectors) ──

export interface QuerySelector {
  tag?: string // short tag name, e.g. 'paragraph', 'run', 'table'
  attrFilters: Array<{ attr: string; value: string }>
  contains?: string // :contains('text')
  has?: QuerySelector // :has(selector)
}

/**
 * Parse a CSS-like selector string.
 * Supported syntax:
 *   "paragraph"                    → all paragraphs
 *   "paragraph[style=Heading1]"   → paragraphs with style Heading1
 *   "run:contains('TODO')"        → runs containing text
 *   "table"                        → all tables
 *   "paragraph[alignment=center]" → paragraphs with center alignment
 */
export function parseSelector(selector: string): { parsed: QuerySelector; error?: DocxNavError } {
  selector = selector.trim()

  // Extract :contains('...')
  let contains: string | undefined
  const containsMatch = selector.match(/:contains\(['"](.+?)['"]\)/)
  if (containsMatch) {
    contains = containsMatch[1]
    selector = selector.replace(/:contains\(['"].+?['"]\)/, '')
  }

  // Extract :has(...)
  let hasSelector: QuerySelector | undefined
  const hasMatch = selector.match(/:has\((.+?)\)/)
  if (hasMatch) {
    const inner = parseSelector(hasMatch[1])
    if (inner.error) return { parsed: null as any, error: inner.error }
    hasSelector = inner.parsed
    selector = selector.replace(/:has\(.+?\)/, '')
  }

  // Extract tag name and attribute filters
  const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)
  const tag = tagMatch ? tagMatch[1] : undefined

  const attrFilters: Array<{ attr: string; value: string }> = []
  const attrRegex = /\[([^=\]]+)=([^\]]+)\]/g
  let attrMatch: RegExpExecArray | null
  while ((attrMatch = attrRegex.exec(selector)) !== null) {
    attrFilters.push({ attr: attrMatch[1].trim(), value: attrMatch[2].trim().replace(/^['"]|['"]$/g, '') })
  }

  return {
    parsed: {
      tag,
      attrFilters,
      contains,
      has: hasSelector,
    },
  }
}

/** Map user-friendly tag names to XML tag names. */
const QUERY_TAG_MAP: Record<string, string> = {
  paragraph: 'w:p',
  run: 'w:r',
  text: 'w:t',
  table: 'w:tbl',
  row: 'w:tr',
  cell: 'w:tc',
  heading: 'w:p',
  hyperlink: 'w:hyperlink',
  image: 'w:drawing',
  bookmark: 'w:bookmarkStart',
  section: 'w:sectPr',
}

function resolveQueryTag(name?: string): string | undefined {
  if (!name) return undefined
  return QUERY_TAG_MAP[name.toLowerCase()] || resolveTag(name)
}

/**
 * Query elements matching the selector within a scope element.
 */
export function queryElements(
  scope: Element,
  selector: string,
): { elements: Array<{ element: Element; path: string }>; error?: DocxNavError } {
  const { parsed, error } = parseSelector(selector)
  if (error) return { elements: [], error }

  const tagName = resolveQueryTag(parsed.tag)

  // Collect candidate elements
  let candidates: Element[] = []
  if (tagName) {
    // Use recursive getElementsByTagName for tag-filtered queries
    candidates = Array.from(scope.getElementsByTagName(tagName))
  } else {
    // No tag filter: walk all elements
    function walk(node: Element) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1) {
          candidates.push(child as Element)
          walk(child as Element)
        }
      }
    }
    walk(scope)
  }

  // Apply filters
  const results: Array<{ element: Element; path: string }> = []
  for (const el of candidates) {
    if (!matchSelector(el, parsed)) continue
    const path = buildElementPath(el, scope)
    results.push({ element: el, path })
  }

  return { elements: results }
}

function matchSelector(el: Element, selector: QuerySelector): boolean {
  // Attribute filters
  for (const filter of selector.attrFilters) {
    if (!matchAttrFilter(el, filter.attr, filter.value)) {
      return false
    }
  }

  // Contains filter
  if (selector.contains !== undefined) {
    const text = extractElementText(el)
    if (!text.includes(selector.contains)) {
      return false
    }
  }

  // Has filter
  if (selector.has) {
    let hasMatch = false
    for (const child of Array.from(el.getElementsByTagName('*'))) {
      if (matchSelector(child as Element, selector.has)) {
        hasMatch = true
        break
      }
    }
    if (!hasMatch) return false
  }

  return true
}

function matchAttrFilter(el: Element, attr: string, value: string): boolean {
  // Special attribute handling
  switch (attr.toLowerCase()) {
    case 'style': {
      const pPr = el.getElementsByTagName('w:pStyle')[0]
      if (!pPr) return false
      return pPr.getAttribute('w:val') === value
    }
    case 'alignment': {
      const pPr = el.getElementsByTagName('w:jc')[0]
      if (!pPr) return false
      return pPr.getAttribute('w:val') === value
    }
    case 'bold': {
      const rPr = el.getElementsByTagName('w:rPr')[0]
      if (!rPr) return value === 'false'
      const b = rPr.getElementsByTagName('w:b')[0]
      return value === 'true' ? !!b : !b
    }
    case 'italic': {
      const rPr = el.getElementsByTagName('w:rPr')[0]
      if (!rPr) return value === 'false'
      const i = rPr.getElementsByTagName('w:i')[0]
      return value === 'true' ? !!i : !i
    }
    default: {
      return el.getAttribute(attr) === value
    }
  }
}

function buildElementPath(el: Element, rootScope: Element): string {
  const segments: string[] = []
  let current: Element = el

  while (current && current !== rootScope) {
    const parent = current.parentNode as Element
    if (!parent) break

    const tag = shortTag(current.tagName)
    let idx = 1
    for (const sibling of Array.from(parent.childNodes)) {
      if (sibling.nodeType === 1 && (sibling as Element).tagName === current.tagName) {
        if (sibling === current) break
        idx++
      }
    }
    segments.unshift(`${tag}[${idx}]`)
    current = parent
  }

  return '/body/' + segments.join('/')
}

// ── Outline / Stats / Issues ──

export function getDocumentOutline(body: Element): Array<{ level: number; text: string; path: string }> {
  const outline: Array<{ level: number; text: string; path: string }> = []
  const paragraphs = body.getElementsByTagName('w:p')

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const pPr = p.getElementsByTagName('w:pPr')[0]
    if (!pPr) continue

    const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
    if (!pStyle) continue

    const styleVal = pStyle.getAttribute('w:val') || ''
    const headingMatch = styleVal.match(/^Heading(\d)$/i)
    if (!headingMatch) continue

    const level = parseInt(headingMatch[1], 10)
    const text = extractElementText(p).slice(0, 120)
    const path = `/body/p[${i + 1}]`

    outline.push({ level, text, path })
  }

  return outline
}

export interface DocumentRun {
  path: string
  text: string
  bold?: boolean
  italic?: boolean
  superscript?: boolean
  subscript?: boolean
  fontSize?: number
  color?: string
}

export function getDocumentText(body: Element): Array<{ index: number; path: string; text: string; style?: string; runs?: DocumentRun[] }> {
  const result: Array<{ index: number; path: string; text: string; style?: string; runs?: DocumentRun[] }> = []
  const paragraphs = body.getElementsByTagName('w:p')

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const text = extractElementText(p)
    if (!text) continue

    const pPr = p.getElementsByTagName('w:pPr')[0]
    let style: string | undefined
    if (pPr) {
      const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
      if (pStyle) style = pStyle.getAttribute('w:val') || undefined
    }

    const runs: DocumentRun[] = []
    const runElements = p.getElementsByTagName('w:r')
    for (let r = 0; r < runElements.length; r++) {
      const runEl = runElements[r]
      const runText = extractElementText(runEl)
      if (!runText) continue
      const rPr = runEl.getElementsByTagName('w:rPr')[0]
      const runInfo: DocumentRun = {
        path: `/body/p[${i + 1}]/r[${r + 1}]`,
        text: runText.slice(0, 200),
      }
      if (rPr) {
        runInfo.bold = !!rPr.getElementsByTagName('w:b')[0]
        runInfo.italic = !!rPr.getElementsByTagName('w:i')[0]
        const va = rPr.getElementsByTagName('w:vertAlign')[0]
        if (va) {
          const v = va.getAttribute('w:val') || ''
          if (v === 'superscript') runInfo.superscript = true
          if (v === 'subscript') runInfo.subscript = true
        }
        const sz = rPr.getElementsByTagName('w:sz')[0]
        if (sz) {
          const szVal = sz.getAttribute('w:val')
          if (szVal) runInfo.fontSize = parseInt(szVal, 10)
        }
        const color = rPr.getElementsByTagName('w:color')[0]
        if (color) {
          runInfo.color = color.getAttribute('w:val') || undefined
        }
      }
      runs.push(runInfo)
    }

    result.push({
      index: i + 1,
      path: `/body/p[${i + 1}]`,
      text: text.slice(0, 500),
      style,
      runs: runs.length > 0 ? runs : undefined,
    })
  }

  return result
}

export function getDocumentStats(body: Element) {
  const paragraphs = body.getElementsByTagName('w:p')
  const tables = body.getElementsByTagName('w:tbl')
  const images = body.getElementsByTagName('w:drawing')

  let wordCount = 0
  let headingCount = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const text = extractElementText(paragraphs[i])
    wordCount += text.split(/\s+/).filter(Boolean).length

    const pPr = paragraphs[i].getElementsByTagName('w:pPr')[0]
    if (pPr) {
      const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
      if (pStyle) {
        const val = pStyle.getAttribute('w:val') || ''
        if (/^Heading\d$/i.test(val)) headingCount++
      }
    }
  }

  return {
    paragraphCount: paragraphs.length,
    tableCount: tables.length,
    imageCount: images.length,
    headingCount,
    wordCount,
  }
}

export function getDocumentIssues(body: Element): Array<{ type: string; message: string; path: string }> {
  const issues: Array<{ type: string; message: string; path: string }> = []
  const paragraphs = body.getElementsByTagName('w:p')

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const text = extractElementText(p)
    const pPr = p.getElementsByTagName('w:pPr')[0]
    const path = `/body/p[${i + 1}]`

    // Empty heading
    if (pPr) {
      const pStyle = pPr.getElementsByTagName('w:pStyle')[0]
      if (pStyle) {
        const val = pStyle.getAttribute('w:val') || ''
        if (/^Heading\d$/i.test(val) && !text.trim()) {
          issues.push({ type: 'empty_heading', message: `Empty heading: ${val}`, path })
        }
      }
    }

    // Very long paragraph
    if (text.length > 2000) {
      issues.push({ type: 'long_paragraph', message: `Paragraph exceeds 2000 chars (${text.length})`, path })
    }
  }

  return issues
}
