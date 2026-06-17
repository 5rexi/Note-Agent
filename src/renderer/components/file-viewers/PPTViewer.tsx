import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Presentation, RefreshCw } from 'lucide-react'
import { renderPptx, type Slide, type SlideText, type SlideShape } from './pptx-render'

interface PPTViewerProps {
  filePath: string
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** One slide, scaled to fit the available width. */
function SlideView({ slide, scale }: { slide: Slide; scale: number }) {
  return (
    <div className="mx-auto" style={{ width: slide.width * scale, height: slide.height * scale, marginBottom: 14 }}>
      <div
        style={{
          position: 'relative', width: slide.width, height: slide.height,
          background: slide.background || '#ffffff',
          transform: `scale(${scale})`, transformOrigin: 'top left',
          boxShadow: '0 1px 6px rgba(0,0,0,0.3)', overflow: 'hidden',
        }}
      >
        {slide.elements.map((el, i) => {
          if (el.kind === 'image') {
            return <img key={i} src={el.src} draggable={false}
              style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, objectFit: 'contain' }} />
          }
          if (el.kind === 'shape') {
            const s = el as SlideShape
            return <div key={i} style={{
              position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h,
              background: s.fill || 'transparent',
              border: s.lineColor ? `${Math.max(1, s.lineWidth || 1)}px solid ${s.lineColor}` : undefined,
              borderRadius: s.ellipse ? '50%' : s.radius ? s.radius : undefined,
            }} />
          }
          const t = el as SlideText
          const justify = t.anchor === 'center' ? 'center' : t.anchor === 'bottom' ? 'flex-end' : 'flex-start'
          return (
            <div key={i} style={{
              position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h,
              display: 'flex', flexDirection: 'column', justifyContent: justify,
              textAlign: t.align, overflow: 'hidden', lineHeight: 1.2,
              padding: '4.8px 9.6px', boxSizing: 'border-box',
            }}>
              {t.paragraphs.map((runs, pi) => (
                <div key={pi} style={{ minHeight: '1em' }}>
                  {runs.map((r, ri) => (
                    <span key={ri} style={{
                      fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal',
                      color: r.color || '#000', fontSize: r.sizePx || 18, whiteSpace: 'pre-wrap',
                    }}>{r.text}</span>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PPTViewer({ filePath }: PPTViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [slides, setSlides] = useState<Slide[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)

  const load = useCallback(async () => {
    setIsLoading(true); setError(null); setSlides(null)
    try {
      const res = await window.electronAPI.readFileBase64(filePath)
      if (res.error) throw new Error(res.error)
      const parsed = await renderPptx(base64ToUint8Array(res.data))
      if (parsed.length === 0) throw new Error('未能解析任何幻灯片')
      setSlides(parsed)
      setIsLoading(false)
    } catch (e: any) {
      setError(e?.message || '解析失败')
      setIsLoading(false)
    }
  }, [filePath])

  useEffect(() => { load() }, [load])

  // Fit slide width to the available pane width.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !slides || slides.length === 0) return
    const compute = () => {
      const avail = el.clientWidth - 32
      setScale(Math.min(1.4, Math.max(0.1, avail / slides[0].width)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [slides])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 shrink-0"
        style={{ height: 36, borderBottom: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-sidebar)' }}>
        <div className="flex items-center">
          <Presentation className="w-3.5 h-3.5 mr-1.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>PowerPoint 预览</span>
          {slides && <span className="ml-2 text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>· {slides.length} 页</span>}
        </div>
        <button onClick={load} disabled={isLoading}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
          style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
          title="重新渲染">
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          刷新
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto py-4 relative" style={{ background: '#525659' }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ color: '#ddd' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /><span className="text-sm">渲染中...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center z-10" style={{ color: '#ddd', background: '#525659' }}>
            <span className="text-sm mb-1" style={{ color: '#fca5a5' }}>解析失败: {error}</span>
            <span className="text-[11px]" style={{ color: '#aaa' }}>请确认文件为有效的 .pptx</span>
          </div>
        )}
        {slides && slides.map((s, i) => <SlideView key={i} slide={s} scale={scale} />)}
      </div>
    </div>
  )
}
