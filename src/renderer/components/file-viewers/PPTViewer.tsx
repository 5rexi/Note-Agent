import { useState, useEffect } from 'react'
import { Loader2, Presentation, RefreshCw } from 'lucide-react'

interface PPTViewerProps {
  filePath: string
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

export default function PPTViewer({ filePath }: PPTViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cachedHit, setCachedHit] = useState(false)

  const loadPdf = async (forceRefresh = false) => {
    setIsLoading(true)
    setError(null)
    setPdfUrl(null)
    setCachedHit(false)

    try {
      if (!forceRefresh) {
        const cacheResult = await window.electronAPI.pdfGetCachedPath(filePath)
        if (cacheResult.isFresh && cacheResult.pdfPath) {
          setCachedHit(true)
          const base64Result = await window.electronAPI.readFileBase64(cacheResult.pdfPath)
          if (!base64Result.error) {
            const buffer = base64ToArrayBuffer(base64Result.data)
            const blob = new Blob([buffer], { type: 'application/pdf' })
            setPdfUrl(URL.createObjectURL(blob))
            setIsLoading(false)
            return
          }
        }
      } else {
        await window.electronAPI.pdfInvalidateCache(filePath)
      }

      const result = await window.electronAPI.officeConvertToPdf(filePath)
      if (result.error) {
        setError(result.error)
        setIsLoading(false)
      } else if (result.pdfPath) {
        const base64Result = await window.electronAPI.readFileBase64(result.pdfPath)
        if (base64Result.error) {
          setError(base64Result.error)
        } else {
          try {
            const buffer = base64ToArrayBuffer(base64Result.data)
            const blob = new Blob([buffer], { type: 'application/pdf' })
            setPdfUrl(URL.createObjectURL(blob))
          } catch (e: any) {
            setError(e.message || '无法解析 PDF')
          }
        }
        setIsLoading(false)
      }
    } catch (e: any) {
      setError(e.message || '转换失败')
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPdf()

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [filePath])

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
        <div className="flex items-center">
          <Presentation className="w-3.5 h-3.5 mr-1.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
            PowerPoint 预览
          </span>
          {cachedHit && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>
              缓存
            </span>
          )}
        </div>
        <button
          onClick={() => loadPdf(true)}
          disabled={isLoading}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
          style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
          title="强制重新生成 PDF"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          刷新
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">转换中...</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            <span className="text-sm mb-2" style={{ color: 'var(--na-status-explore)' }}>转换失败: {error}</span>
            <span className="text-[11px]">请确保已安装 LibreOffice 或相关转换工具</span>
          </div>
        )}
        {pdfUrl && (
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            style={{ border: 'none' }}
            title="PPT Preview"
          />
        )}
      </div>
    </div>
  )
}
