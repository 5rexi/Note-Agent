import { useState, useRef, useCallback, useEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, Loader2 } from 'lucide-react'

interface ImageViewerProps {
  filePath: string
}

export default function ImageViewer({ filePath }: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Load image via base64 IPC (avoids file:// protocol restrictions in Electron renderer)
  useEffect(() => {
    setIsLoading(true)
    setError(null)
    setImageSrc(null)
    setScale(1)
    setPosition({ x: 0, y: 0 })

    const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
    }
    const mime = mimeMap[ext] || 'image/png'

    window.electronAPI.readFileBase64(filePath).then((result) => {
      if (result.error) {
        setError(result.error)
      } else {
        setImageSrc(`data:${mime};base64,${result.data}`)
      }
      setIsLoading(false)
    })
  }, [filePath])

  // Native wheel handler with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale((prev) => {
          const next = Math.max(0.1, Math.min(5, prev + delta))
          return next
        })
      }
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY }
      posStart.current = { ...position }
    }
  }, [scale, position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPosition({
      x: posStart.current.x + dx,
      y: posStart.current.y + dy,
    })
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const reset = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const zoomIn = () => setScale((prev) => Math.min(5, prev + 0.2))
  const zoomOut = () => setScale((prev) => Math.max(0.1, prev - 0.2))

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: 36,
          borderBottom: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
            {scale === 1 ? '100%' : `${Math.round(scale * 100)}%`}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={zoomOut}
            className="p-1.5 rounded transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
            title="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={zoomIn}
            className="p-1.5 rounded transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={reset}
            className="p-1.5 rounded transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
            title="重置"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center"
        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {isLoading && (
          <div className="flex flex-col items-center gap-2" style={{ color: 'var(--na-text-tertiary)' }}>
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-[12px]">加载图片...</span>
          </div>
        )}
        {error && !isLoading && (
          <div className="text-[12px]" style={{ color: 'var(--na-status-explore)' }}>
            加载失败: {error}
          </div>
        )}
        {imageSrc && !isLoading && (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              userSelect: 'none',
            }}
          />
        )}
      </div>

      {/* Hint */}
      <div
        className="shrink-0 text-center py-1"
        style={{
          borderTop: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <span className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>
          Ctrl + 滚轮缩放 · 放大后可拖拽移动
        </span>
      </div>
    </div>
  )
}
