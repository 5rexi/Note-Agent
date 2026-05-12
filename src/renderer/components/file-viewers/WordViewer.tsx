import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, FileText, Eye, FileType, AlertCircle, Code, RefreshCw, List, ExternalLink, Quote, Undo, Columns } from 'lucide-react'
import { toast } from 'sonner'
import { themeAtom } from '../../atoms'

interface WordViewerProps {
  filePath: string
}

type ViewMode = 'html' | 'pdf' | 'split'

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

export default function WordViewer({ filePath }: WordViewerProps) {
  const theme = useAtomValue(themeAtom)
  const isDark = theme === 'dark'
  const [wordEnabled, setWordEnabled] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('html')
  const [html, setHtml] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConverting, setIsConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUnpacking, setIsUnpacking] = useState(false)
  const [cachedHit, setCachedHit] = useState(false)
  const [showStructure, setShowStructure] = useState(false)
  const [structureItems, setStructureItems] = useState<Array<{ type: string; summary: string; style?: string; lineStart: number; lineEnd: number }>>([])
  const [structureLoading, setStructureLoading] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null)
  const [selectedParagraphs, setSelectedParagraphs] = useState<{ startIdx: number; endIdx: number } | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean } | null>(null)
  const [editingParagraph, setEditingParagraph] = useState<number | null>(null)
  const isSavingRef = useRef(false)
  const isDoc = filePath.toLowerCase().endsWith('.doc')
  const structureRef = useRef<HTMLDivElement>(null)
  const htmlContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Load wordEnabled state
  useEffect(() => {
    window.electronAPI.getSetting('wordSupport').then((raw) => {
      if (raw) {
        try {
          const config = JSON.parse(raw)
          setWordEnabled(config.enabled === true)
        } catch {
          setWordEnabled(false)
        }
      } else {
        setWordEnabled(false)
      }
    })
  }, [])

  // When wordEnabled loads, set default view mode
  useEffect(() => {
    setViewMode(wordEnabled ? 'pdf' : 'html')
  }, [wordEnabled])

  // When switching to split mode, ensure both previews are loaded
  useEffect(() => {
    if (viewMode === 'split') {
      if (!html) loadHtmlPreview()
      if (!pdfUrl && !isConverting && wordEnabled) loadPdfPreview()
    }
  }, [viewMode])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu?.visible) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.word-context-menu')) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  // The HTML from wordConvertToIndexedHtml already has correct data-p-index
  const processedHtml = useMemo(() => {
    if (!html) return null
    if (isDark) {
      // Replace default light-mode colors with dark-mode equivalents,
      // while preserving any document-specific colors (e.g. blue links, red marks).
      return html
        .replace(/color:\s*#333;?/g, 'color: #d0d0d0;')
        .replace(/color:\s*#1a1a1a;?/g, 'color: #f0f0f0;')
        .replace(/border:\s*1px\s+solid\s+#ddd;?/g, 'border: 1px solid #555;')
    }
    return html
  }, [html, isDark])

  // Load HTML preview — use backend document.xml parser for 100% index sync
  const loadHtmlPreview = useCallback(() => {
    setIsLoading(true)
    setError(null)
    setHtml(null)
    setCachedHit(false)

    window.electronAPI.wordConvertToIndexedHtml(filePath)
      .then((result) => {
        if (result.error) {
          setError(result.error)
          setIsLoading(false)
          return
        }
        setHtml(result.html || '')
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err.message || '转换失败')
        setIsLoading(false)
      })
  }, [filePath])

  // Load PDF preview (soffice conversion with cache)
  const loadPdfPreview = useCallback(async (forceRefresh = false) => {
    setIsConverting(true)
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
            setIsConverting(false)
            return
          }
        }
      } else {
        // Force refresh: invalidate cache first
        await window.electronAPI.pdfInvalidateCache(filePath)
      }

      const result = await window.electronAPI.wordConvertToPdf(filePath)
      if (result.error || !result.pdfPath) {
        setError(result.error || 'PDF 转换失败')
        setIsConverting(false)
        return
      }

      const base64Result = await window.electronAPI.readFileBase64(result.pdfPath)
      if (base64Result.error) {
        setError(base64Result.error)
        setIsConverting(false)
        return
      }

      const buffer = base64ToArrayBuffer(base64Result.data)
      const blob = new Blob([buffer], { type: 'application/pdf' })
      setPdfUrl(URL.createObjectURL(blob))
      setIsConverting(false)
    } catch (e: any) {
      setError(e.message || 'PDF 加载失败')
      setIsConverting(false)
    }
  }, [filePath])

  // Double-click to edit paragraph
  useEffect(() => {
    const container = htmlContainerRef.current
    if (!container) return

    const handleDblClick = (e: MouseEvent) => {
      if (editingParagraph !== null) return
      const target = e.target as HTMLElement
      const paragraphEl = target.closest('[data-p-index]') as HTMLElement | null
      if (!paragraphEl) return
      const idx = paragraphEl.getAttribute('data-p-index')
      if (idx === null) return
      const pIndex = parseInt(idx, 10)
      setEditingParagraph(pIndex)
      paragraphEl.contentEditable = 'true'
      paragraphEl.style.outline = '2px solid var(--na-accent)'
      paragraphEl.style.background = isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)'
      paragraphEl.focus()
      // Select all text
      const range = document.createRange()
      range.selectNodeContents(paragraphEl)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }

    container.addEventListener('dblclick', handleDblClick)
    return () => container.removeEventListener('dblclick', handleDblClick)
  }, [editingParagraph, processedHtml, isDark])

  // Handle edit save/cancel
  useEffect(() => {
    if (editingParagraph === null) return
    const container = htmlContainerRef.current
    if (!container) return
    const el = container.querySelector(`[data-p-index="${editingParagraph}"]`) as HTMLElement | null
    if (!el) return

    const originalText = el.textContent || ''

    const handleBlur = () => {
      const newText = el.innerText || ''
      setEditingParagraph(null)
      el.contentEditable = 'false'
      el.style.outline = ''
      el.style.background = ''

      isSavingRef.current = true
      window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'saving' } }))
      window.electronAPI.wordReplaceParagraph(filePath, editingParagraph + 1, newText)
        .then((result) => {
          if (result.success) {
            // Instead of reloading the entire HTML (which causes flicker and scroll jump),
            // directly update the edited paragraph's text in the DOM.
            const container = htmlContainerRef.current
            if (container) {
              const pEl = container.querySelector(`[data-p-index="${editingParagraph}"]`)
              if (pEl) {
                pEl.textContent = newText
              }
            }
            window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'saved' } }))
            // Keep isSavingRef true for 3s to cover the file watcher poll interval (2s).
            // This prevents the watcher from triggering loadHtmlPreview after the file is modified.
            setTimeout(() => {
              isSavingRef.current = false
              window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'idle' } }))
            }, 3000)
          } else {
            isSavingRef.current = false
            // Only reload on failure to restore original content
            loadHtmlPreview()
            window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'error' } }))
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'idle' } }))
            }, 3000)
          }
        })
        .catch(() => {
          isSavingRef.current = false
          window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'error' } }))
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'idle' } }))
          }, 3000)
        })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        el.blur()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        el.textContent = originalText
        setEditingParagraph(null)
        el.contentEditable = 'false'
        el.style.outline = ''
        el.style.background = ''
      }
    }

    el.addEventListener('blur', handleBlur)
    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('blur', handleBlur)
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [editingParagraph, filePath, loadHtmlPreview])

  // Load preview based on mode
  useEffect(() => {
    if (viewMode === 'html') {
      loadHtmlPreview()
    } else {
      loadPdfPreview()
    }
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
        setPdfUrl(null)
      }
    }
  }, [filePath, viewMode])

  // Clear selection when clicking outside the HTML container AND outside the toolbar
  useEffect(() => {
    if (viewMode !== 'html' || !processedHtml) return
    const container = htmlContainerRef.current
    if (!container) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      const toolbar = toolbarRef.current
      // Don't clear if clicking inside the floating toolbar
      if (toolbar && toolbar.contains(target)) return
      if (!container.contains(target)) {
        setSelectedText('')
        setToolbarPos(null)
        setSelectedParagraphs(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [viewMode, processedHtml])

  // Watch external edits (LibreOffice + agent tools + fs:undoWrite)
  useEffect(() => {
    if (!filePath) return
    window.electronAPI.wordWatchExternal(filePath)
    const unsubWord = window.electronAPI.onWordExternalChanged((changedPath) => {
      if (changedPath === filePath && !isSavingRef.current) {
        if (viewMode === 'pdf') {
          loadPdfPreview(true)
        } else {
          loadHtmlPreview()
        }
      }
    })
    const unsubFs = window.electronAPI.onFileChanged((event) => {
      if (event.path === filePath && !isSavingRef.current) {
        if (viewMode === 'pdf') {
          loadPdfPreview(true)
        } else {
          loadHtmlPreview()
        }
      }
    })
    return () => {
      unsubWord()
      unsubFs()
      window.electronAPI.wordUnwatchExternal(filePath)
    }
  }, [filePath, viewMode, loadHtmlPreview, loadPdfPreview])

  // Check undo availability (multi-step undo via SQLite)
  useEffect(() => {
    if (!filePath) return
    const checkUndo = () => {
      window.electronAPI.getUndoCount(filePath)
        .then((r) => setCanUndo(r.count > 0))
        .catch(() => setCanUndo(false))
    }
    checkUndo()
    const timer = setInterval(checkUndo, 3000)
    return () => clearInterval(timer)
  }, [filePath])

  // Ctrl+Z undo shortcut
  useEffect(() => {
    if (!filePath) return
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        const result = await window.electronAPI.wordUndoChange(filePath)
        if (result.success) {
          toast.success('已撤销')
          if (viewMode === 'html') loadHtmlPreview()
          else loadPdfPreview(true)
          const countRes = await window.electronAPI.getUndoCount(filePath)
          setCanUndo(countRes.count > 0)
        } else {
          toast.error('撤销失败: ' + (result.error || '未知错误'))
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [filePath, canUndo, viewMode, loadHtmlPreview, loadPdfPreview])

  // Load structure when panel opens
  useEffect(() => {
    if (!showStructure || structureItems.length > 0) return
    setStructureLoading(true)
    window.electronAPI.wordAnalyzeStructure(filePath)
      .then((result) => {
        if (result.error) {
          setStructureItems([{ type: 'other', summary: '解析失败: ' + result.error, lineStart: 0, lineEnd: 0 }])
        } else {
          setStructureItems(result.items)
        }
        setStructureLoading(false)
      })
      .catch(() => {
        setStructureItems([{ type: 'other', summary: '解析失败', lineStart: 0, lineEnd: 0 }])
        setStructureLoading(false)
      })
  }, [showStructure, filePath, structureItems.length])

  // Close structure panel when clicking outside
  useEffect(() => {
    if (!showStructure) return
    const handler = (e: MouseEvent) => {
      if (structureRef.current && !structureRef.current.contains(e.target as Node)) {
        setShowStructure(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showStructure])

  const activeBtnStyle = {
    background: 'var(--na-accent-soft)',
    color: 'var(--na-accent)',
  }
  const inactiveBtnStyle = {
    background: 'transparent',
    color: 'var(--na-text-tertiary)',
  }

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
          <FileText className="w-3.5 h-3.5 mr-1.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
            Word 预览
          </span>
          {isDoc && (
            <span
              className="ml-2 px-1.5 py-0.5 text-[10px] rounded"
              style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
            >
              .doc 旧格式
            </span>
          )}
          {cachedHit && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>
              缓存
            </span>
          )}
          {!wordEnabled && (
            <span
              className="ml-2 px-1.5 py-0.5 text-[10px] rounded flex items-center gap-1"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706' }}
            >
              <AlertCircle className="w-2.5 h-2.5" />
              Word 支持未启用，使用快速预览
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {canUndo && (
            <button
              onClick={async () => {
                const result = await window.electronAPI.wordUndoChange(filePath)
                if (result.success) {
                  toast.success('已撤销')
                  if (viewMode === 'html') loadHtmlPreview()
                  else loadPdfPreview(true)
                  const countRes = await window.electronAPI.getUndoCount(filePath)
                  setCanUndo(countRes.count > 0)
                } else {
                  toast.error('撤销失败: ' + (result.error || '未知错误'))
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
              title="撤销上次修改 (Ctrl+Z)"
            >
              <Undo className="w-3 h-3" />
              撤销
            </button>
          )}
          {wordEnabled && (
            <button
              onClick={async () => {
                const result = await window.electronAPI.wordOpenWithLibreOffice(filePath)
                if (!result.success) {
                  setError(result.error || '启动 LibreOffice 失败')
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
              style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
              title="用 LibreOffice Writer 编辑"
            >
              <ExternalLink className="w-3 h-3" />
              LO 编辑
            </button>
          )}
          <button
            onClick={() => setViewMode('html')}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={viewMode === 'html' ? activeBtnStyle : inactiveBtnStyle}
            title="HTML 预览（快速，保留可编辑性）"
          >
            <FileType className="w-3 h-3" />
            HTML
          </button>
          <button
            onClick={() => setViewMode('pdf')}
            disabled={!wordEnabled}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={viewMode === 'pdf' ? activeBtnStyle : { ...inactiveBtnStyle, opacity: wordEnabled ? 1 : 0.4 }}
            title={wordEnabled ? 'PDF 预览（准确，保留原始排版）' : '需要启用 Word 支持'}
          >
            <Eye className="w-3 h-3" />
            PDF
          </button>
          <button
            onClick={() => setViewMode('split')}
            disabled={!wordEnabled}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={viewMode === 'split' ? activeBtnStyle : { ...inactiveBtnStyle, opacity: wordEnabled ? 1 : 0.4 }}
            title={wordEnabled ? 'Split 预览（HTML + PDF 并排）' : '需要启用 Word 支持'}
          >
            <Columns className="w-3 h-3" />
            Split
          </button>
          {wordEnabled && (viewMode === 'pdf' || viewMode === 'split') && (
            <button
              onClick={() => loadPdfPreview(true)}
              disabled={isConverting}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
              style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
              title="强制重新生成 PDF"
            >
              {isConverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              刷新
            </button>
          )}
        </div>
      </div>

      {/* Structure Panel */}
      {showStructure && (
        <div
          ref={structureRef}
          className="absolute right-0 top-[36px] bottom-0 z-20 overflow-y-auto"
          style={{
            width: 280,
            background: 'var(--na-bg-sidebar)',
            borderLeft: '1px solid var(--na-border-subtle)',
          }}
        >
          <div className="px-3 py-2 text-[11px] font-medium" style={{ borderBottom: '1px solid var(--na-border-subtle)', color: 'var(--na-text-secondary)' }}>
            文档结构
          </div>
          {structureLoading && (
            <div className="flex items-center justify-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">解析中...</span>
            </div>
          )}
          {!structureLoading && structureItems.length === 0 && (
            <div className="px-3 py-4 text-xs" style={{ color: 'var(--na-text-tertiary)' }}>无内容</div>
          )}
          {!structureLoading && structureItems.map((item, idx) => (
            <button
              key={idx}
              onClick={async () => {
                // Open document.xml and jump to line
                setIsUnpacking(true)
                try {
                  const result = await window.electronAPI.wordUnpack(filePath)
                  if (result.success && result.outputDir) {
                    const docXmlPath = result.outputDir + '/word/document.xml'
                    window.dispatchEvent(new CustomEvent('word:edit-xml', {
                      detail: { unpackDir: result.outputDir, originalPath: filePath }
                    }))
                    window.dispatchEvent(new CustomEvent('file-tree:open-absolute', {
                      detail: docXmlPath
                    }))
                    // Wait for editor to open then jump to line
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('word:jump-to-line', {
                        detail: { line: item.lineStart, endLine: item.lineEnd }
                      }))
                    }, 300)
                  }
                } catch (e: any) {
                  setError(e.message || '解压失败')
                } finally {
                  setIsUnpacking(false)
                }
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] hover:opacity-80 transition-colors"
              style={{
                borderBottom: '1px solid var(--na-border-subtle)',
                color: item.type === 'other' ? 'var(--na-accent)' : 'var(--na-text-secondary)',
              }}
              title={`行 ${item.lineStart + 1} - ${item.lineEnd + 1}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] opacity-60 shrink-0" style={{ minWidth: 16 }}>
                  {item.type === 'table' ? '▦' : item.type === 'other' ? '§' : '¶'}
                </span>
                <span className="truncate">{item.summary}</span>
              </div>
              {item.style && (
                <div className="text-[10px] opacity-50 mt-0.5 ml-[22px]">{item.style}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* HTML Preview */}
        {viewMode === 'html' && (
          <div className="h-full overflow-auto">
            {isLoading && (
              <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">加载文档...</span>
              </div>
            )}
            {error && !isLoading && (
              <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-status-explore)' }}>
                <span className="text-sm">加载失败: {error}</span>
              </div>
            )}
            {processedHtml && (
              <div
                ref={htmlContainerRef}
                className="p-8 max-w-[800px] mx-auto"
                style={{
                  background: isDark ? '#141414' : '#fff',
                  color: isDark ? '#d0d0d0' : 'inherit',
                  minHeight: '100%',
                }}
                dangerouslySetInnerHTML={{ __html: processedHtml }}
                onMouseUp={() => {
                  if (editingParagraph !== null) return
                  setTimeout(() => {
                    const sel = window.getSelection()
                    if (!sel || sel.rangeCount === 0) {
                      setSelectedText('')
                      setToolbarPos(null)
                      setSelectedParagraphs(null)
                      return
                    }
                    const text = sel.toString().trim()
                    if (!text || text.length === 0) {
                      setSelectedText('')
                      setToolbarPos(null)
                      setSelectedParagraphs(null)
                      return
                    }
                    const range = sel.getRangeAt(0)
                    const container = htmlContainerRef.current
                    const inContainer = container ? container.contains(range.commonAncestorContainer) : false
                    if (!container || !inContainer) {
                      setSelectedText('')
                      setToolbarPos(null)
                      setSelectedParagraphs(null)
                      return
                    }
                    // Pre-compute paragraph indices while selection is still alive
                    let startNode: Node | null = range.startContainer
                    let endNode: Node | null = range.endContainer
                    if (startNode.nodeType === Node.TEXT_NODE) startNode = startNode.parentElement
                    if (endNode.nodeType === Node.TEXT_NODE) endNode = endNode.parentElement
                    const startEl = (startNode as Element | null)?.closest('[data-p-index]')
                    const endEl = (endNode as Element | null)?.closest('[data-p-index]')
                    const startIdx = startEl ? parseInt(startEl.getAttribute('data-p-index') || '-1', 10) : -1
                    const endIdx = endEl ? parseInt(endEl.getAttribute('data-p-index') || '-1', 10) : startIdx
                    setSelectedText(text)
                    setSelectedParagraphs(startIdx >= 0 ? { startIdx, endIdx: Math.max(startIdx, endIdx) } : null)
                    const rect = range.getBoundingClientRect()
                    setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top - 8 })
                  }, 10)
                }}
                onMouseDown={() => {
                  setSelectedText('')
                  setToolbarPos(null)
                  setSelectedParagraphs(null)
                  setContextMenu(null)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, visible: true })
                }}
              />
            )}
            {/* Floating toolbar for text selection */}
            {/* Context menu for HTML preview */}
            {contextMenu?.visible && (
              <div
                className="fixed z-[200] flex flex-col gap-0.5 py-1 rounded-md shadow-lg"
                style={{
                  left: contextMenu.x,
                  top: contextMenu.y,
                  background: 'var(--na-bg-popover)',
                  border: '1px solid var(--na-border-subtle)',
                  minWidth: 160,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {selectedText && selectedParagraphs && (
                  <button
                    onClick={async () => {
                      try {
                        const structure = await window.electronAPI.wordAnalyzeStructure(filePath)
                        if (structure.error || !structure.items) {
                          toast.error(structure.error || '解析文档失败')
                          setContextMenu(null)
                          return
                        }
                        const paragraphs = []
                        const { startIdx, endIdx } = selectedParagraphs
                        for (let i = startIdx; i <= Math.max(startIdx, endIdx); i++) {
                          const item = structure.items[i]
                          if (item && item.fullText.trim() !== '') {
                            paragraphs.push({ index: (item as any).index ?? i, text: item.fullText, style: item.style, lineStart: item.lineStart, lineEnd: item.lineEnd })
                          }
                        }
                        window.dispatchEvent(new CustomEvent('word:text-selected', {
                          detail: { filePath, fileName: filePath.split('/').pop() || filePath, selectedText, paragraphs },
                        }))
                        toast.success('已引用到对话')
                      } catch (e: any) {
                        toast.error('引用失败: ' + e.message)
                      }
                      setContextMenu(null)
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-secondary)' }}
                  >
                    <Quote className="w-3.5 h-3.5" />
                    引用到对话
                  </button>
                )}
                {selectedText && <div className="mx-2 my-0.5" style={{ height: 1, background: 'var(--na-border-subtle)' }} />}
                <button
                  onClick={() => { loadHtmlPreview(); setContextMenu(null) }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                  style={{ color: 'var(--na-text-secondary)' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  刷新预览
                </button>
                <button
                  onClick={() => { window.electronAPI.wordOpenWithLibreOffice(filePath); setContextMenu(null) }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                  style={{ color: 'var(--na-text-secondary)' }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  在 LibreOffice 中打开
                </button>
              </div>
            )}
          </div>
        )}

        {/* PDF Preview */}
        {viewMode === 'pdf' && (
          <div className="h-full overflow-hidden">
            {isConverting && (
              <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">转换为 PDF...</span>
              </div>
            )}
            {error && !isConverting && (
              <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--na-status-explore)' }}>
                <span className="text-sm">PDF 转换失败: {error}</span>
                <button
                  onClick={() => setViewMode('html')}
                  className="px-3 py-1 text-[11px] rounded transition-colors"
                  style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
                >
                  切换回 HTML 预览
                </button>
              </div>
            )}
            {pdfUrl && !isConverting && (
              <iframe
                src={pdfUrl}
                className="w-full h-full"
                style={{ border: 'none' }}
                title="Word PDF Preview"
              />
            )}
          </div>
        )}

        {/* Split Preview */}
        {viewMode === 'split' && (
          <div className="h-full grid grid-cols-2">
            {/* Left: HTML */}
            <div className="h-full overflow-auto border-r border-[var(--na-border-subtle)]">
              {isLoading && (
                <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">加载文档...</span>
                </div>
              )}
              {error && !isLoading && (
                <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-status-explore)' }}>
                  <span className="text-sm">加载失败: {error}</span>
                </div>
              )}
              {processedHtml && (
                <div
                  ref={htmlContainerRef}
                  className="p-4"
                  style={{
                    background: isDark ? '#141414' : '#fff',
                    color: isDark ? '#d0d0d0' : 'inherit',
                    minHeight: '100%',
                  }}
                  dangerouslySetInnerHTML={{ __html: processedHtml }}
                  onMouseUp={() => {
                    if (editingParagraph !== null) return
                    setTimeout(() => {
                      const sel = window.getSelection()
                      if (!sel || sel.rangeCount === 0) {
                        setSelectedText('')
                        setToolbarPos(null)
                        setSelectedParagraphs(null)
                        return
                      }
                      const text = sel.toString().trim()
                      if (!text || text.length === 0) {
                        setSelectedText('')
                        setToolbarPos(null)
                        setSelectedParagraphs(null)
                        return
                      }
                      const range = sel.getRangeAt(0)
                      const container = htmlContainerRef.current
                      const inContainer = container ? container.contains(range.commonAncestorContainer) : false
                      if (!container || !inContainer) {
                        setSelectedText('')
                        setToolbarPos(null)
                        setSelectedParagraphs(null)
                        return
                      }
                      let startNode: Node | null = range.startContainer
                      let endNode: Node | null = range.endContainer
                      if (startNode.nodeType === Node.TEXT_NODE) startNode = startNode.parentElement
                      if (endNode.nodeType === Node.TEXT_NODE) endNode = endNode.parentElement
                      const startEl = (startNode as Element | null)?.closest('[data-p-index]')
                      const endEl = (endNode as Element | null)?.closest('[data-p-index]')
                      const startIdx = startEl ? parseInt(startEl.getAttribute('data-p-index') || '-1', 10) : -1
                      const endIdx = endEl ? parseInt(endEl.getAttribute('data-p-index') || '-1', 10) : startIdx
                      setSelectedText(text)
                      setSelectedParagraphs(startIdx >= 0 ? { startIdx, endIdx: Math.max(startIdx, endIdx) } : null)
                      const rect = range.getBoundingClientRect()
                      setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top - 8 })
                    }, 10)
                  }}
                  onMouseDown={() => {
                    setSelectedText('')
                    setToolbarPos(null)
                    setSelectedParagraphs(null)
                    setContextMenu(null)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, visible: true })
                  }}
                />
              )}
              {contextMenu?.visible && (
                <div
                  className="fixed z-[200] flex flex-col gap-0.5 py-1 rounded-md shadow-lg"
                  style={{
                    left: contextMenu.x,
                    top: contextMenu.y,
                    background: 'var(--na-bg-popover)',
                    border: '1px solid var(--na-border-subtle)',
                    minWidth: 160,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {selectedText && selectedParagraphs && (
                    <button
                      onClick={async () => {
                        try {
                          const structure = await window.electronAPI.wordAnalyzeStructure(filePath)
                          if (structure.error || !structure.items) {
                            toast.error(structure.error || '解析文档失败')
                            setContextMenu(null)
                            return
                          }
                          const paragraphs = []
                          const { startIdx, endIdx } = selectedParagraphs
                          for (let i = startIdx; i <= Math.max(startIdx, endIdx); i++) {
                            const item = structure.items[i]
                            if (item && item.fullText.trim() !== '') {
                              paragraphs.push({ index: (item as any).index ?? i, text: item.fullText, style: item.style, lineStart: item.lineStart, lineEnd: item.lineEnd })
                            }
                          }
                          window.dispatchEvent(new CustomEvent('word:text-selected', {
                            detail: { filePath, fileName: filePath.split('/').pop() || filePath, selectedText, paragraphs },
                          }))
                          toast.success('已引用到对话')
                        } catch (e: any) {
                          toast.error('引用失败: ' + e.message)
                        }
                        setContextMenu(null)
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                      style={{ color: 'var(--na-text-secondary)' }}
                    >
                      <Quote className="w-3.5 h-3.5" />
                      引用到对话
                    </button>
                  )}
                  {selectedText && <div className="mx-2 my-0.5" style={{ height: 1, background: 'var(--na-border-subtle)' }} />}
                  <button
                    onClick={() => { loadHtmlPreview(); setContextMenu(null) }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-secondary)' }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    刷新预览
                  </button>
                  <button
                    onClick={() => { window.electronAPI.wordOpenWithLibreOffice(filePath); setContextMenu(null) }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-secondary)' }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    在 LibreOffice 中打开
                  </button>
                </div>
              )}
            </div>
            {/* Right: PDF */}
            <div className="h-full overflow-hidden">
              {isConverting && (
                <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">转换为 PDF...</span>
                </div>
              )}
              {error && !isConverting && (
                <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--na-status-explore)' }}>
                  <span className="text-sm">PDF 转换失败: {error}</span>
                  <button
                    onClick={() => setViewMode('html')}
                    className="px-3 py-1 text-[11px] rounded transition-colors"
                    style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
                  >
                    切换回 HTML 预览
                  </button>
                </div>
              )}
              {pdfUrl && !isConverting && (
                <iframe
                  src={pdfUrl}
                  className="w-full h-full"
                  style={{ border: 'none' }}
                  title="Word PDF Preview"
                />
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
