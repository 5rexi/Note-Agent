import { useState, useEffect, useCallback } from 'react'
import { Play, Loader2, FileText } from 'lucide-react'

interface LaTeXViewerProps {
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

export default function LaTeXViewer({ filePath }: LaTeXViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isCompiling, setIsCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compileLog, setCompileLog] = useState('')
  const [cachedHit, setCachedHit] = useState(false)

  const loadPdfAsBlob = useCallback(async (path: string) => {
    const result = await window.electronAPI.readFileBase64(path)
    if (result.error) {
      setError(result.error)
      return
    }
    try {
      const buffer = base64ToArrayBuffer(result.data)
      const blob = new Blob([buffer], { type: 'application/pdf' })
      setPdfUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setError(e.message || '无法解析 PDF')
    }
  }, [])

  const compile = useCallback(async () => {
    setIsCompiling(true)
    setError(null)
    setCompileLog('')
    setCachedHit(false)
    try {
      const result = await window.electronAPI.latexCompile(filePath)
      if (result.error) {
        setError(result.error)
        setCompileLog(result.log || '')
      } else if (result.pdfPath) {
        setCompileLog(result.log || '')
        await loadPdfAsBlob(result.pdfPath)
      }
    } catch (e: any) {
      setError(e.message || '编译失败')
    } finally {
      setIsCompiling(false)
    }
  }, [filePath, loadPdfAsBlob])

  // On mount: check cache first, then auto-compile if needed
  useEffect(() => {
    let cancelled = false

    async function init() {
      // Check PDF cache
      const cacheResult = await window.electronAPI.pdfGetCachedPath(filePath)
      if (!cancelled && cacheResult.isFresh && cacheResult.pdfPath) {
        setCachedHit(true)
        await loadPdfAsBlob(cacheResult.pdfPath)
        return
      }

      // No valid cache — auto compile
      if (!cancelled) {
        compile()
      }
    }

    init()

    return () => {
      cancelled = true
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [filePath, compile, loadPdfAsBlob])

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
          <FileText className="w-3.5 h-3.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
            LaTeX
          </span>
          {cachedHit && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>
              缓存
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {error && (
            <span className="text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
              编译错误
            </span>
          )}
          <button
            onClick={compile}
            disabled={isCompiling}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
            style={{
              color: isCompiling ? 'var(--na-text-tertiary)' : 'var(--na-status-ask)',
              borderRadius: 'var(--na-radius-sm)',
              background: isCompiling ? 'transparent' : 'rgba(5,150,105,0.08)',
            }}
            title="编译 LaTeX"
          >
            {isCompiling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {isCompiling ? '编译中...' : '编译'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            style={{ border: 'none' }}
            title="LaTeX PDF Preview"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            {isCompiling ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <span className="text-sm">正在编译...</span>
              </>
            ) : error ? (
              <>
                <span className="text-sm mb-2" style={{ color: 'var(--na-status-explore)' }}>编译失败</span>
                <pre className="text-[11px] max-w-[80%] max-h-[60%] overflow-auto p-3 rounded" style={{ background: 'var(--na-bg-sidebar)', color: 'var(--na-text-secondary)' }}>
                  {error}
                  {compileLog && `\n--- 日志 ---\n${compileLog}`}
                </pre>
              </>
            ) : (
              <>
                <FileText className="w-8 h-8 mb-2 opacity-40" />
                <span className="text-sm">点击"编译"生成 PDF 预览</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
