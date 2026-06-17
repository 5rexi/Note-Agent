import { useState, useEffect, lazy, Suspense } from 'react'
import { FileText, Loader2 } from 'lucide-react'
const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

interface PDFViewerProps {
  filePath: string
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default function PDFViewer({ filePath }: PDFViewerProps) {
  const [data, setData] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null); setError(null)
    window.electronAPI.readFileBase64(filePath).then((result) => {
      if (result.error) setError(result.error)
      else {
        try { setData(base64ToUint8Array(result.data)) } catch (e: any) { setError(e.message || '无法解析 PDF') }
      }
    })
  }, [filePath])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      <div className="flex items-center px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-sidebar)' }}>
        <FileText className="w-3.5 h-3.5 mr-1.5" style={{ color: 'var(--na-text-tertiary)' }} />
        <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>PDF 预览</span>
      </div>
      <div className="flex-1 overflow-hidden relative">
        {error ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--na-status-explore)' }}>加载失败: {error}</div>
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}><Loader2 className="w-5 h-5 animate-spin" /></div>}>
            <PdfJsViewer data={data} docKey={filePath} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
