import { useEffect, useRef, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, Quote, Copy } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, TextLayer, setLayerDimensions, type PDFDocumentProxy } from 'pdfjs-dist'
import { useContextMenu } from '../ui/ContextMenu'
import { themeAtom } from '../../atoms'
// @ts-ignore - Vite resolves the worker + css to URLs
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  data: Uint8Array | null
  /** Stable per-document key (source file path) used to remember scroll position. */
  docKey?: string
  /** Forward sync: scroll to a PDF position (page 1-based, y in PDF points from
   *  the page top). Re-applied whenever `nonce` changes. */
  gotoPos?: { page: number; y: number; nonce: number } | null
  /** Double-click in the PDF → the clicked position (page, x, y in PDF points). */
  onPdfDoubleClick?: (pos: { page: number; x: number; y: number }) => void
  /** Reverse sync: the page + y (PDF points) at the top of the viewport. */
  onViewportPos?: (pos: { page: number; y: number }) => void
  onQuote?: (text: string) => void
}

/** Remembered scroll RATIO per document, so re-opening a PDF resumes where you
 *  left off (within the session) instead of jumping to the top. */
const pdfScrollMemory = new Map<string, number>()

/** Parsed-document LRU cache keyed by docKey — switching away and back to a PDF
 *  (or a re-render) skips the expensive re-parse. Bounded; the oldest parsed doc
 *  is destroyed when the bound is exceeded. A cheap content signature guards
 *  against serving a stale parse after a recompile. */
const PDF_DOC_CACHE_MAX = 6
const pdfDocCache = new Map<string, { pdf: PDFDocumentProxy; sig: string }>()
function dataSig(data: Uint8Array): string {
  const n = data.length
  return `${n}:${data[0] ?? 0}:${data[(n / 2) | 0] ?? 0}:${data[n - 1] ?? 0}`
}

interface TextEntry { str: string; top: number }
const clamp = (v: number, lo = 0.3, hi = 5) => Math.max(lo, Math.min(hi, v))

/** Toolbar-less pdf.js renderer: fit-width + Ctrl+wheel zoom, selectable text
 *  layer, text-based sync/jump. The parsed document is cached so resizing/zooming
 *  only re-renders canvases (no expensive re-parse). */
export default function PdfJsViewer({ data, docKey, gotoPos, onPdfDoubleClick, onViewportPos, onQuote }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const baseWidthRef = useRef(612)  // first page width (pt) at scale 1
  const fitRef = useRef(1)          // fit-to-width scale
  const zoomRef = useRef(1)         // user zoom multiplier (Ctrl+wheel)
  const textIndexRef = useRef<TextEntry[]>([])
  const renderTokenRef = useRef(0)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programmatic = useRef(false)
  // Lazy rendering: pages are rasterized only when near the viewport.
  const pageObserverRef = useRef<IntersectionObserver | null>(null)
  const renderedPagesRef = useRef<Set<number>>(new Set())
  const pageTextRef = useRef<Map<number, TextEntry[]>>(new Map())
  const currentScaleRef = useRef(1)   // effective px-per-PDF-point (for SyncTeX)
  // Preview render quality: 'auto' (page-count heuristic) | high | balanced | low.
  const qualityRef = useRef<'auto' | 'high' | 'balanced' | 'low'>('auto')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ctxMenu = useContextMenu()
  const isDark = useAtomValue(themeAtom) === 'dark'

  // Lay out page placeholders (correct sizes) for the whole document, then
  // rasterize pages LAZILY as they approach the viewport (IntersectionObserver).
  // This makes long PDFs open instantly (no up-front rasterization of every page)
  // and bounds memory (pages far from view are un-rendered).
  const render = useCallback(async () => {
    const pdf = pdfRef.current
    const container = containerRef.current
    if (!pdf || !container) return
    const scale = clamp(fitRef.current * zoomRef.current)
    // Oversample so vector text stays crisp even on 100%-scale (dpr=1) displays.
    const baseDpr = window.devicePixelRatio || 1
    const pages = pdf.numPages
    const q = qualityRef.current
    const dpr =
      q === 'high' ? Math.max(baseDpr, 2)
      : q === 'balanced' ? Math.max(baseDpr, 1.5)
      : q === 'low' ? baseDpr
      : /* auto */ (pages <= 20 ? Math.max(baseDpr, 2) : pages <= 50 ? Math.max(baseDpr, 1.5) : baseDpr)
    currentScaleRef.current = scale
    const token = ++renderTokenRef.current

    // Preserve the reading position across re-renders (resize / zoom).
    const prevH = container.scrollHeight
    const scrollRatio = prevH > 0 ? container.scrollTop / prevH : 0

    pageObserverRef.current?.disconnect()
    const rendered = renderedPagesRef.current; rendered.clear()
    const pageText = pageTextRef.current; pageText.clear()
    textIndexRef.current = []
    container.innerHTML = ''

    const rebuildIndex = () => {
      const all: TextEntry[] = []
      pageText.forEach((arr) => { for (const e of arr) all.push(e) })
      textIndexRef.current = all.sort((a, b) => a.top - b.top)
    }

    // Rasterize one page (canvas + selectable text layer) into its placeholder.
    const renderPage = async (wrap: HTMLDivElement) => {
      const p = parseInt(wrap.dataset.page || '0', 10)
      if (!p || rendered.has(p)) return
      rendered.add(p)
      try {
        const page = await pdf.getPage(p)
        if (token !== renderTokenRef.current) { rendered.delete(p); return }
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width * dpr)
        canvas.height = Math.ceil(viewport.height * dpr)
        canvas.style.cssText = `width:${Math.floor(viewport.width)}px;height:${Math.floor(viewport.height)}px;display:block`
        wrap.appendChild(canvas)
        const textLayerDiv = document.createElement('div')
        textLayerDiv.className = 'textLayer'
        setLayerDimensions(textLayerDiv, viewport)
        wrap.appendChild(textLayerDiv)
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined } as any).promise
        if (token !== renderTokenRef.current) return
        const tc = await page.getTextContent()
        const tl = new TextLayer({ textContentSource: tc as any, container: textLayerDiv, viewport })
        await tl.render()
        const entries: TextEntry[] = []
        textLayerDiv.querySelectorAll('span').forEach((span) => {
          const s = (span.textContent || '').trim()
          if (s.length >= 2) entries.push({ str: s, top: wrap.offsetTop + (span as HTMLElement).offsetTop })
        })
        pageText.set(p, entries)
        rebuildIndex()
      } catch { rendered.delete(p) }
    }

    // Free a page's heavy canvas/text DOM when it scrolls far away (text-index
    // positions are kept, so sync still works for visited pages).
    const unrenderPage = (wrap: HTMLDivElement) => {
      const p = parseInt(wrap.dataset.page || '0', 10)
      if (!p || !rendered.has(p)) return
      rendered.delete(p)
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild)
    }

    // Build placeholders for every page (getPage is cheap — no rasterization).
    const wraps: HTMLDivElement[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      if (token !== renderTokenRef.current) return
      const viewport = page.getViewport({ scale })
      const w = Math.floor(viewport.width), h = Math.floor(viewport.height)
      const wrap = document.createElement('div')
      wrap.dataset.page = String(p)
      wrap.style.cssText = `position:relative;margin:0 auto 12px;width:${w}px;height:${h}px;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.3)`
      wrap.style.setProperty('--scale-factor', String(scale))
      wrap.style.setProperty('--total-scale-factor', String(scale))
      container.appendChild(wrap)
      wraps.push(wrap)
    }
    if (token !== renderTokenRef.current) return

    // Restore the relative reading position now that placeholders give the
    // correct scroll height (before lazily rasterizing the visible pages).
    if (scrollRatio > 0) {
      programmatic.current = true
      container.scrollTop = scrollRatio * container.scrollHeight
      setTimeout(() => { programmatic.current = false }, 120)
    }

    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) renderPage(e.target as HTMLDivElement)
        else unrenderPage(e.target as HTMLDivElement)
      }
    }, { root: container, rootMargin: '800px 0px' })
    for (const wrap of wraps) observer.observe(wrap)
    pageObserverRef.current = observer
  }, [])

  const scheduleRender = useCallback(() => {
    if (renderTimer.current) clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => { render() }, 130)
  }, [render])

  // Disconnect the lazy-render observer on unmount.
  useEffect(() => () => { pageObserverRef.current?.disconnect() }, [])

  // Load the user's preview-quality preference (re-render when it changes).
  useEffect(() => {
    let cancelled = false
    window.electronAPI.getSetting('previewRenderQuality').then((v) => {
      if (cancelled) return
      if (v === 'high' || v === 'balanced' || v === 'low' || v === 'auto') {
        qualityRef.current = v
        if (pdfRef.current) scheduleRender()
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [scheduleRender])

  // Load (parse) the document once per data; render at fit-width.
  useEffect(() => {
    if (!data) return
    let cancelled = false
    setLoading(true); setError(null); ctxMenu.close()
    textIndexRef.current = []
    zoomRef.current = 1
    ;(async () => {
      try {
        // Reuse a cached parse for this doc if the content matches; else parse
        // and store (LRU, destroying the oldest / a stale entry).
        const sig = dataSig(data)
        let pdf: PDFDocumentProxy
        const cached = docKey != null ? pdfDocCache.get(docKey) : undefined
        if (cached && cached.sig === sig) {
          pdf = cached.pdf
          pdfDocCache.delete(docKey!); pdfDocCache.set(docKey!, cached) // refresh LRU
        } else {
          pdf = await getDocument({ data: data.slice(0) }).promise
          if (docKey != null) {
            const stale = pdfDocCache.get(docKey)
            if (stale && stale.pdf !== pdf) { try { stale.pdf.destroy() } catch { /* ignore */ } }
            pdfDocCache.set(docKey, { pdf, sig })
            while (pdfDocCache.size > PDF_DOC_CACHE_MAX) {
              const oldest = pdfDocCache.keys().next().value
              if (oldest === undefined || oldest === docKey) break
              const ev = pdfDocCache.get(oldest)
              if (ev && ev.pdf !== pdf) { try { ev.pdf.destroy() } catch { /* ignore */ } }
              pdfDocCache.delete(oldest)
            }
          }
        }
        if (cancelled) return
        pdfRef.current = pdf
        baseWidthRef.current = (await pdf.getPage(1)).getViewport({ scale: 1 }).width
        const avail = (containerRef.current?.clientWidth || baseWidthRef.current) - 28
        fitRef.current = clamp(avail / baseWidthRef.current)
        await render()
        // Restore the remembered reading position BEFORE revealing the content
        // (the loading overlay still covers it → no top-then-jump flash).
        if (!cancelled && docKey != null && containerRef.current) {
          const saved = pdfScrollMemory.get(docKey)
          if (saved && saved > 0) {
            programmatic.current = true
            containerRef.current.scrollTop = saved * containerRef.current.scrollHeight
            setTimeout(() => { programmatic.current = false }, 150)
          }
        }
        if (!cancelled) setLoading(false)
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'PDF render failed'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [data, render, docKey])

  // Resize → recompute fit scale and re-render (debounced; no re-parse).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (!pdfRef.current || Math.abs(el.clientWidth - w) < 6) return
      w = el.clientWidth
      fitRef.current = clamp((w - 28) / baseWidthRef.current)
      scheduleRender()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scheduleRender])

  // Ctrl/Cmd + wheel → zoom (native non-passive listener so preventDefault works).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomRef.current = clamp(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
      scheduleRender()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scheduleRender])

  // Forward sync (SyncTeX): scroll to (page, y). Placeholders exist for every
  // page even before they rasterize, so this works regardless of lazy rendering.
  // Retries a few frames in case the page layout isn't built yet (post-compile).
  useEffect(() => {
    if (!gotoPos) return
    let tries = 0
    const apply = () => {
      const c = containerRef.current
      if (!c) return
      const wrap = c.querySelector(`[data-page="${gotoPos.page}"]`) as HTMLElement | null
      if (!wrap || wrap.offsetHeight === 0) { if (tries++ < 40) requestAnimationFrame(apply); return }
      programmatic.current = true
      c.scrollTo({ top: Math.max(0, wrap.offsetTop + gotoPos.y * currentScaleRef.current - 60), behavior: 'auto' })
      setTimeout(() => { programmatic.current = false }, 250)
    }
    requestAnimationFrame(apply)
  }, [gotoPos])

  /** The page + y (PDF points) at the top of the viewport, from placeholders. */
  const viewportPos = (el: HTMLElement): { page: number; y: number } | null => {
    const st = el.scrollTop
    const wraps = el.querySelectorAll('[data-page]')
    for (let i = 0; i < wraps.length; i++) {
      const w = wraps[i] as HTMLElement
      if (st < w.offsetTop + w.offsetHeight) {
        return { page: parseInt(w.dataset.page || '1', 10), y: Math.max(0, (st - w.offsetTop) / currentScaleRef.current) }
      }
    }
    return null
  }

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    // Remember the reading position (skip while programmatically restoring).
    if (!programmatic.current && docKey != null && el.scrollHeight > 0) {
      pdfScrollMemory.set(docKey, el.scrollTop / el.scrollHeight)
    }
    if (programmatic.current || !onViewportPos) return
    const p = viewportPos(el)
    if (p) onViewportPos(p)
  }, [onViewportPos, docKey])

  // Double-click → (page, x, y) in PDF points for SyncTeX inverse lookup.
  const handleDoubleClick = useCallback((ev: React.MouseEvent) => {
    if (!onPdfDoubleClick) return
    const wrap = (ev.target as HTMLElement).closest('[data-page]') as HTMLElement | null
    if (!wrap) return
    const page = parseInt(wrap.dataset.page || '0', 10)
    if (!page) return
    const r = wrap.getBoundingClientRect()
    const scale = currentScaleRef.current || 1
    onPdfDoubleClick({ page, x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale })
  }, [onPdfDoubleClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const text = window.getSelection()?.toString().trim() || ''
    if (!text) return
    ctxMenu.open(e, [
      ...(onQuote ? [{ icon: Quote, label: '引用到对话', onClick: () => { onQuote(text); window.getSelection()?.removeAllRanges() } }] : []),
      { icon: Copy, label: '复制', onClick: () => navigator.clipboard.writeText(text).catch(() => {}) },
    ])
  }, [onQuote, ctxMenu])

  return (
    <div className="relative h-full w-full" style={{ background: isDark ? '#1a1a1a' : '#525659' }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ color: '#ddd' }}>
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> <span className="text-sm">加载 PDF…</span>
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center text-sm z-10" style={{ color: '#fca5a5' }}>{error}</div>}
      {/* Dark mode: invert the rendered pages (black bg / white text) — like the
          Word preview. hue-rotate keeps colored content roughly true. */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-auto py-3"
        style={{ filter: isDark ? 'invert(1) hue-rotate(180deg)' : undefined }}
        onScroll={handleScroll}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu.menu}
    </div>
  )
}
