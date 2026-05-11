import { useState, useEffect } from 'react'
import { FileText, Loader2 } from 'lucide-react'

interface PDFViewerProps {
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

export default function PDFViewer({ filePath }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    setPdfUrl(null)

    window.electronAPI.readFileBase64(filePath).then((result) => {
      if (result.error) {
        setError(result.error)
      } else {
        try {
          const buffer = base64ToArrayBuffer(result.data)
          const blob = new Blob([buffer], { type: 'application/pdf' })
          setPdfUrl(URL.createObjectURL(blob))
        } catch (e: any) {
          setError(e.message || '无法解析 PDF')
        }
      }
      setIsLoading(false)
    })

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [filePath])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center px-3 shrink-0"
        style={{
          height: 36,
          borderBottom: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <FileText className="w-3.5 h-3.5 mr-1.5" style={{ color: 'var(--na-text-tertiary)' }} />
        <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>PDF 预览</span>
      </div>

      {/* PDF content */}
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">加载 PDF...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--na-status-explore)' }}>
            加载失败: {error}
          </div>
        )}
        {pdfUrl && !isLoading && (
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            style={{ border: 'none' }}
            title="PDF Preview"
          />
        )}
      </div>
    </div>
  )
}
