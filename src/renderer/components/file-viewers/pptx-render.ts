/**
 * Self-contained PPTX → slide-model renderer.
 *
 * Parses each slide's shape tree from the .pptx zip (OOXML) with only jszip +
 * DOMParser — no native binaries (no LibreOffice/pandoc) and no heavy deps —
 * and emits absolutely-positioned text boxes, shapes and images sized in "slide
 * pixels" (96dpi). Covers text (font size / bold / italic / color / alignment),
 * shape fills/outlines (rect / roundRect / ellipse) and embedded images, which
 * is the bulk of real decks (including everything pptxgenjs generates). Complex
 * DrawingML (gradients, custom geometry, charts, SmartArt) is not reproduced —
 * this is a fast, reliable preview, not a pixel-perfect render.
 */
import JSZip from 'jszip'

const EMU_PER_PX = 9525 // 914400 EMU/inch ÷ 96 px/inch
const emuToPx = (emu: number) => emu / EMU_PER_PX
const ptToPx = (pt: number) => (pt * 96) / 72

export interface TextRun {
  text: string
  bold: boolean
  italic: boolean
  color?: string
  sizePx?: number
}
export interface SlideText {
  kind: 'text'
  x: number; y: number; w: number; h: number
  align: 'left' | 'center' | 'right' | 'justify'
  anchor: 'top' | 'center' | 'bottom'
  paragraphs: TextRun[][]
}
export interface SlideImage {
  kind: 'image'
  x: number; y: number; w: number; h: number
  src: string
}
export interface SlideShape {
  kind: 'shape'
  x: number; y: number; w: number; h: number
  fill?: string
  lineColor?: string
  lineWidth?: number
  /** Corner radius in px (roundRect). */
  radius?: number
  /** Render as an ellipse. */
  ellipse?: boolean
}
export type SlideElement = SlideText | SlideImage | SlideShape

export interface Slide {
  width: number
  height: number
  background?: string
  elements: SlideElement[]
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf',
}

function attr(el: Element | null, name: string): string | null {
  return el ? el.getAttribute(name) : null
}
function numAttr(el: Element | null, name: string, fallback = 0): number {
  const v = attr(el, name)
  const n = v == null ? NaN : parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}
/** First descendant with the given local name (namespace-agnostic). */
function firstLocal(root: Element, local: string): Element | null {
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) return all[i]
  return null
}
function childrenLocal(root: Element, local: string): Element[] {
  const out: Element[] = []
  for (let i = 0; i < root.childNodes.length; i++) {
    const n = root.childNodes[i] as Element
    if (n.nodeType === 1 && n.localName === local) out.push(n)
  }
  return out
}

function solidColor(spPr: Element | null): string | undefined {
  if (!spPr) return undefined
  const fill = firstLocal(spPr, 'solidFill')
  if (!fill) return undefined
  const srgb = firstLocal(fill, 'srgbClr')
  if (srgb) { const v = attr(srgb, 'val'); return v ? `#${v}` : undefined }
  return undefined
}

function parseXfrm(spPr: Element | null) {
  if (!spPr) return null
  const xfrm = firstLocal(spPr, 'xfrm')
  if (!xfrm) return null
  const off = firstLocal(xfrm, 'off')
  const ext = firstLocal(xfrm, 'ext')
  if (!off || !ext) return null
  return {
    x: emuToPx(numAttr(off, 'x')),
    y: emuToPx(numAttr(off, 'y')),
    w: emuToPx(numAttr(ext, 'cx')),
    h: emuToPx(numAttr(ext, 'cy')),
  }
}

function parseTextBody(txBody: Element): SlideText['paragraphs'] {
  const paragraphs: SlideText['paragraphs'] = []
  for (const p of childrenLocal(txBody, 'p')) {
    const runs: TextRun[] = []
    for (let i = 0; i < p.childNodes.length; i++) {
      const node = p.childNodes[i] as Element
      if (node.nodeType !== 1) continue
      if (node.localName === 'r') {
        const t = firstLocal(node, 't')
        const text = t?.textContent ?? ''
        if (!text) continue
        const rPr = childrenLocal(node, 'rPr')[0] || null
        runs.push({
          text,
          bold: attr(rPr, 'b') === '1',
          italic: attr(rPr, 'i') === '1',
          color: solidColor(rPr),
          sizePx: rPr && attr(rPr, 'sz') ? ptToPx(numAttr(rPr, 'sz') / 100) : undefined,
        })
      } else if (node.localName === 'br') {
        runs.push({ text: '\n', bold: false, italic: false })
      }
    }
    paragraphs.push(runs)
  }
  return paragraphs
}

function alignOf(txBody: Element): SlideText['align'] {
  const p = childrenLocal(txBody, 'p')[0]
  const pPr = p ? childrenLocal(p, 'pPr')[0] : null
  switch (attr(pPr || null, 'algn')) {
    case 'ctr': return 'center'
    case 'r': return 'right'
    case 'just': return 'justify'
    default: return 'left'
  }
}

/** Parse one slide XML into a model, resolving image rels to data URLs. */
function parseSlide(
  doc: Document,
  size: { w: number; h: number },
  rels: Map<string, string>,
  media: Map<string, string>,
): Slide {
  const slide: Slide = { width: size.w, height: size.h, elements: [] }
  const root = doc.documentElement

  // Background solid color (srgb only).
  const bg = firstLocal(root, 'bg')
  if (bg) slide.background = solidColor(firstLocal(bg, 'bgPr') || bg)

  const spTree = firstLocal(root, 'spTree')
  if (!spTree) return slide

  for (let i = 0; i < spTree.childNodes.length; i++) {
    const node = spTree.childNodes[i] as Element
    if (node.nodeType !== 1) continue

    if (node.localName === 'sp') {
      const spPr = firstLocal(node, 'spPr')
      const box = parseXfrm(spPr)
      if (!box) continue

      // Shape fill / outline / geometry (rendered behind any text). This is the
      // bulk of pptxgenjs decks: colored rectangles, rounded panels, accent bars.
      const geom = firstLocal(spPr!, 'prstGeom')
      const prst = attr(geom, 'prst')
      const fill = solidColor(spPr)
      const ln = firstLocal(spPr!, 'ln')
      const lineColor = solidColor(ln)
      const lineWidthEmu = ln ? numAttr(ln, 'w', 0) : 0
      if (prst || fill || lineColor) {
        const isEllipse = prst === 'ellipse'
        let radius: number | undefined
        if (prst === 'roundRect') {
          // adj (fraction × 100000) of the shorter side; default ~16.67%.
          const gd = geom ? firstLocal(geom, 'gd') : null
          const adj = gd ? parseInt((attr(gd, 'fmla') || '').replace(/[^0-9]/g, ''), 10) : NaN
          const frac = Number.isFinite(adj) ? adj / 100000 : 0.1667
          radius = Math.min(box.w, box.h) * frac
        }
        slide.elements.push({
          kind: 'shape', ...box,
          fill, lineColor,
          lineWidth: lineWidthEmu ? emuToPx(lineWidthEmu) : undefined,
          radius, ellipse: isEllipse,
        })
      }

      // Text on top (same box).
      const txBody = firstLocal(node, 'txBody')
      if (txBody) {
        const paragraphs = parseTextBody(txBody)
        if (paragraphs.some((p) => p.some((r) => r.text.trim()))) {
          const bodyPr = firstLocal(txBody, 'bodyPr')
          const anchorV = attr(bodyPr, 'anchor')
          slide.elements.push({
            kind: 'text', ...box,
            align: alignOf(txBody),
            anchor: anchorV === 'ctr' ? 'center' : anchorV === 'b' ? 'bottom' : 'top',
            paragraphs,
          })
        }
      }
    } else if (node.localName === 'pic') {
      const spPr = firstLocal(node, 'spPr')
      const box = parseXfrm(spPr)
      const blip = firstLocal(node, 'blip')
      const embed = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : null
      if (!box || !embed) continue
      const target = rels.get(embed)
      if (!target) continue
      const src = media.get(target)
      if (src) slide.elements.push({ kind: 'image', ...box, src })
    }
  }
  return slide
}

/** Render a .pptx (raw bytes) into an array of slide models. */
export async function renderPptx(data: Uint8Array): Promise<Slide[]> {
  const zip = await JSZip.loadAsync(data)
  const parser = new DOMParser()

  // Slide size from presentation.xml (fallback 16:9 @ 960×540 px).
  let size = { w: 960, h: 540 }
  const presFile = zip.file('ppt/presentation.xml')
  if (presFile) {
    const presDoc = parser.parseFromString(await presFile.async('string'), 'application/xml')
    const sldSz = firstLocal(presDoc.documentElement, 'sldSz')
    if (sldSz) size = { w: emuToPx(numAttr(sldSz, 'cx', 9144000)), h: emuToPx(numAttr(sldSz, 'cy', 6858000)) }
  }

  // Decode every media file once into a data URL.
  const media = new Map<string, string>()
  const mediaFiles = zip.file(/^ppt\/media\//)
  for (const f of mediaFiles) {
    const ext = f.name.split('.').pop()?.toLowerCase() || 'png'
    const b64 = await f.async('base64')
    media.set(f.name, `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}`)
  }

  // Collect + natural-sort slide files (slide1, slide2, … slide10).
  const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => {
      const na = parseInt(a.name.match(/slide(\d+)\.xml/)?.[1] || '0', 10)
      const nb = parseInt(b.name.match(/slide(\d+)\.xml/)?.[1] || '0', 10)
      return na - nb
    })

  const slides: Slide[] = []
  for (const sf of slideFiles) {
    try {
      // Resolve this slide's relationships (rId → media path).
      const relName = `ppt/slides/_rels/${sf.name.split('/').pop()}.rels`
      const rels = new Map<string, string>()
      const relFile = zip.file(relName)
      if (relFile) {
        const relDoc = parser.parseFromString(await relFile.async('string'), 'application/xml')
        const rs = relDoc.getElementsByTagName('*')
        for (let i = 0; i < rs.length; i++) {
          if (rs[i].localName !== 'Relationship') continue
          const id = rs[i].getAttribute('Id')
          let tgt = rs[i].getAttribute('Target') || ''
          if (!id || !tgt) continue
          tgt = tgt.replace(/^(\.\.\/)+/, 'ppt/').replace(/^\/?ppt\//, 'ppt/')
          if (!tgt.startsWith('ppt/')) tgt = `ppt/${tgt.replace(/^\.\//, '')}`
          rels.set(id, tgt)
        }
      }
      const doc = parser.parseFromString(await sf.async('string'), 'application/xml')
      slides.push(parseSlide(doc, size, rels, media))
    } catch {
      slides.push({ width: size.w, height: size.h, elements: [] })
    }
  }
  return slides
}
