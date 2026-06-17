import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Play, Loader2, FileText, RefreshCw } from 'lucide-react'
import type { editor as monacoEditor } from 'monaco-editor'
const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

interface LaTeXViewerProps {
  filePath: string
  editor?: monacoEditor.IStandaloneCodeEditor | null
  sourceFile?: string
  syncEnabled?: boolean
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Strip LaTeX markup to plain words for text matching against the rendered PDF. */
function plainFromTex(s: string): string {
  return s.replace(/%.*$/, '').replace(/\\[a-zA-Z@]+\*?/g, ' ').replace(/[\\{}$&~^_[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function LaTeXViewer({ filePath, editor, sourceFile, syncEnabled }: LaTeXViewerProps) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [isCompiling, setIsCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compileLog, setCompileLog] = useState('')
  const [cachedHit, setCachedHit] = useState(false)
  const [gotoPos, setGotoPos] = useState<{ page: number; y: number; nonce: number } | null>(null)
  const [synctexPath, setSynctexPath] = useState<string>()
  const [fwdPending, setFwdPending] = useState(false)

  const [autoCompile, setAutoCompile] = useState(true)
  const depsRef = useRef<Set<string>>(new Set())   // basenames of tracked deps
  const baseOf = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p

  const syncLock = useRef(0)
  const lock = () => { syncLock.current = Date.now() }
  const locked = () => Date.now() - syncLock.current < 350

  const loadPdf = useCallback(async (path: string) => {
    const result = await window.electronAPI.readFileBase64(path)
    if (result.error) { setError(result.error); return }
    try { setPdfData(base64ToUint8Array(result.data)) } catch (e: any) { setError(e.message || '无法解析 PDF') }
  }, [])

  // force=true bypasses the cache (Compile button + auto-on-save). The handler
  // returns the cached PDF instantly when nothing (main .tex or its deps) changed.
  const compile = useCallback(async (force = false, fast = false) => {
    setIsCompiling(true); setError(null); setCompileLog('')
    try {
      const result = await window.electronAPI.latexCompile(filePath, force ? { force: true, fast } : undefined)
      if (result.error) { setError(result.error); setCompileLog(result.log || ''); setCachedHit(false) }
      else if (result.pdfPath) {
        setCompileLog(result.log || '')
        setCachedHit(/缓存/.test(result.log || ''))
        if (result.deps) depsRef.current = new Set(result.deps.map(baseOf))
        if (result.synctexPath) setSynctexPath(result.synctexPath)
        await loadPdf(result.pdfPath)
        // After a force (edit/manual) recompile, sync the PDF to the editor's
        // position rather than restoring a now-stale scroll ratio.
        if (force) setFwdPending(true)
      }
    } catch (e: any) { setError(e.message || '编译失败') } finally { setIsCompiling(false) }
  }, [filePath, loadPdf])

  // Load the auto-compile preference (default on).
  useEffect(() => {
    window.electronAPI.getSetting('latexAutoCompile').then((v: any) => setAutoCompile(v !== 'false')).catch(() => {})
  }, [])

  // Initial open: compile (uses signature cache → instant if fresh).
  useEffect(() => {
    let cancelled = false
    ;(async () => { if (!cancelled) await compile(false) })()
    return () => { cancelled = true }
  }, [filePath, compile])

  // Auto-compile on save: recompile when the .tex OR a tracked dependency
  // (\input/.bib/image) changes. Listens to BOTH the editor's direct `file:saved`
  // event (reliable, same renderer) and the workspace fs.watch (`onFileChanged`,
  // for external edits). Ignores compile by-products (.aux/.log/.pdf) so it never
  // loops. Debounced.
  useEffect(() => {
    if (!autoCompile) return
    const mainBase = baseOf(filePath)
    let timer: ReturnType<typeof setTimeout> | null = null
    const trigger = (changedPath: string) => {
      const b = baseOf(changedPath)
      if (b !== mainBase && !depsRef.current.has(b)) return
      if (timer) clearTimeout(timer)
      // Fast single-pass for the quick save-preview; the Compile button does full.
      timer = setTimeout(() => compile(true, true), 600)
    }
    const unsub = window.electronAPI.onFileChanged((e: { type: string; path: string }) => trigger(e.path))
    const onSaved = (e: Event) => { const p = (e as CustomEvent).detail?.path; if (p) trigger(p) }
    window.addEventListener('file:saved', onSaved)
    return () => { if (timer) clearTimeout(timer); unsub(); window.removeEventListener('file:saved', onSaved) }
  }, [autoCompile, filePath, compile])

  // Forward sync (SyncTeX): editor's top line → precise PDF (page, y). Debounced.
  useEffect(() => {
    if (!syncEnabled || !editor || !synctexPath) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const disp = editor.onDidScrollChange(() => {
      if (locked()) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        const line = editor.getVisibleRanges()[0]?.startLineNumber || 1
        lock()
        try {
          const pos = await window.electronAPI.synctexForward({ synctexPath, sourceFile: sourceFile || filePath, line })
          if (pos) setGotoPos({ ...pos, nonce: Date.now() })
        } catch { /* ignore */ }
      }, 150)
    })
    return () => { if (timer) clearTimeout(timer); disp.dispose() }
  }, [syncEnabled, editor, synctexPath, sourceFile, filePath])

  // After a force recompile, jump the PDF to the editor's current line.
  useEffect(() => {
    if (!fwdPending) return
    setFwdPending(false)
    if (!syncEnabled || !editor || !synctexPath) return
    ;(async () => {
      const line = editor.getVisibleRanges()[0]?.startLineNumber || 1
      try {
        const pos = await window.electronAPI.synctexForward({ synctexPath, sourceFile: sourceFile || filePath, line })
        if (pos) setGotoPos({ ...pos, nonce: Date.now() })
      } catch { /* ignore */ }
    })()
  }, [fwdPending, pdfData, synctexPath, syncEnabled, editor, sourceFile, filePath])

  // Reverse sync (SyncTeX): PDF viewport top (page, y) → editor line.
  const handleViewportPos = useCallback(async ({ page, y }: { page: number; y: number }) => {
    if (!syncEnabled || !editor || !synctexPath || locked()) return
    lock()
    try {
      const res = await window.electronAPI.synctexInverse({ synctexPath, page, x: 0, y })
      if (res?.line) editor.revealLineNearTop(res.line)
    } catch { /* ignore */ }
  }, [syncEnabled, editor, synctexPath])

  // Double-click in the PDF → precise editor line via SyncTeX inverse.
  const handlePdfDoubleClick = useCallback(async ({ page, x, y }: { page: number; x: number; y: number }) => {
    if (!editor || !synctexPath) return
    try {
      const res = await window.electronAPI.synctexInverse({ synctexPath, page, x, y })
      if (res?.line) {
        lock()
        editor.setPosition({ lineNumber: res.line, column: 1 })
        editor.setScrollTop(editor.getTopForLineNumber(res.line))
        editor.focus()
      }
    } catch { /* ignore */ }
  }, [editor, synctexPath])

  // Selected PDF text → quote into the chat composer.
  const handleQuote = useCallback((text: string) => {
    const fp = sourceFile || filePath
    const fileName = fp.replace(/\\/g, '/').split('/').pop() || fp
    window.dispatchEvent(new CustomEvent('editor:text-selected', {
      detail: { type: 'latex', filePath: fp, fileName, selectedText: text, range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } },
    }))
  }, [sourceFile, filePath])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      <div className="flex items-center justify-between px-3 shrink-0" style={{ height: 36, borderBottom: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-sidebar)' }}>
        <div className="flex items-center gap-1">
          <FileText className="w-3.5 h-3.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>LaTeX</span>
          {cachedHit && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>缓存</span>}
          {pdfData && <span className="ml-1 text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>· 双击跳转 · 右键引用</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {error && <span className="text-[11px]" style={{ color: 'var(--na-status-explore)' }}>编译错误</span>}
          <button
            onClick={() => { const next = !autoCompile; setAutoCompile(next); window.electronAPI.setSetting('latexAutoCompile', String(next)) }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
            style={{ color: autoCompile ? 'var(--na-primary)' : 'var(--na-text-tertiary)', borderRadius: 'var(--na-radius-sm)', background: autoCompile ? 'var(--na-primary-soft)' : 'transparent' }}
            title="保存时自动重新编译"
          >
            <RefreshCw className="w-3 h-3" /> 自动{autoCompile ? '：开' : '：关'}
          </button>
          <button onClick={() => compile(true)} disabled={isCompiling} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
            style={{ color: isCompiling ? 'var(--na-text-tertiary)' : 'var(--na-status-ask)', borderRadius: 'var(--na-radius-sm)', background: isCompiling ? 'transparent' : 'rgba(5,150,105,0.08)' }} title="强制重新编译（忽略缓存）">
            {isCompiling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {isCompiling ? '编译中...' : '编译'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {pdfData ? (
          <Suspense fallback={<div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}><Loader2 className="w-5 h-5 animate-spin" /></div>}>
            <PdfJsViewer data={pdfData} docKey={`tex:${sourceFile || filePath}`} gotoPos={gotoPos} onViewportPos={handleViewportPos} onPdfDoubleClick={handlePdfDoubleClick} onQuote={handleQuote} />
          </Suspense>
        ) : (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            {isCompiling ? (
              <><Loader2 className="w-6 h-6 animate-spin mb-2" /><span className="text-sm">正在编译...</span></>
            ) : error ? (
              <>
                <span className="text-sm mb-2" style={{ color: 'var(--na-status-explore)' }}>编译失败</span>
                <pre className="text-[11px] max-w-[80%] max-h-[60%] overflow-auto p-3 rounded" style={{ background: 'var(--na-bg-sidebar)', color: 'var(--na-text-secondary)' }}>{error}{compileLog && `\n--- 日志 ---\n${compileLog}`}</pre>
              </>
            ) : (
              <><FileText className="w-8 h-8 mb-2 opacity-40" /><span className="text-sm">点击"编译"生成 PDF 预览</span></>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
