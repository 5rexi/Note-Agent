import { useState, useEffect, useCallback, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, FileText, AlertCircle, RefreshCw, List, ExternalLink, Quote, Undo } from 'lucide-react'
import { toast } from 'sonner'
import { renderAsync } from 'docx-preview'
import { themeAtom } from '../../atoms'

interface WordViewerProps {
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

export default function WordViewer({ filePath }: WordViewerProps) {
  const theme = useAtomValue(themeAtom)
  const isDark = theme === 'dark'
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  const containerRef = useRef<HTMLDivElement>(null)
  const styleContainerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  /**
   * Load and render the Word document using docx-preview.
   * .doc files are auto-converted to .docx before rendering.
   * After renderAsync resolves, data-p-index is injected into all <p> tags
   * to support paragraph-level editing.
   */
  const loadDocument = useCallback(async () => {
    if (!containerRef.current) return
    setIsLoading(true)
    setError(null)

    let targetPath = filePath

    try {
      if (isDoc) {
        const convertResult = await window.electronAPI.wordConvertDocToDocx(filePath)
        if (convertResult.error || !convertResult.outputPath) {
          throw new Error(convertResult.error || '.doc 转换失败')
        }
        targetPath = convertResult.outputPath
      }

      const base64Result = await window.electronAPI.readFileBase64(targetPath)
      if (base64Result.error) {
        throw new Error(base64Result.error)
      }

      const buffer = base64ToArrayBuffer(base64Result.data)
      containerRef.current.innerHTML = ''

      await renderAsync(buffer, containerRef.current, styleContainerRef.current || undefined, {
        className: 'docx-viewer',
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
      })

      // Inject data-p-index into all <p> tags for paragraph editing
      if (containerRef.current) {
        const paragraphs = containerRef.current.querySelectorAll('p')
        paragraphs.forEach((p, idx) => {
          p.setAttribute('data-p-index', String(idx))
        })
      }

      setIsLoading(false)
    } catch (err: any) {
      setError(err.message || '加载失败')
      setIsLoading(false)
    }
  }, [filePath, isDoc])

  // Trigger document load when filePath changes
  useEffect(() => {
    loadDocument()
  }, [loadDocument])

  // Cleanup rendered content on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [])

  // Close context menu when clicking outside
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

  // Double-click to edit a paragraph
  useEffect(() => {
    const container = containerRef.current
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
      const range = document.createRange()
      range.selectNodeContents(paragraphEl)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }

    container.addEventListener('dblclick', handleDblClick)
    return () => container.removeEventListener('dblclick', handleDblClick)
  }, [editingParagraph, isDark])

  // Handle paragraph edit save (blur) and cancel (Escape)
  useEffect(() => {
    if (editingParagraph === null) return
    const container = containerRef.current
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
            const container = containerRef.current
            if (container) {
              const pEl = container.querySelector(`[data-p-index="${editingParagraph}"]`)
              if (pEl) {
                pEl.textContent = newText
              }
            }
            window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'saved' } }))
            setTimeout(() => {
              isSavingRef.current = false
              window.dispatchEvent(new CustomEvent('word-viewer:save-status', { detail: { status: 'idle' } }))
            }, 3000)
          } else {
            isSavingRef.current = false
            loadDocument()
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
  }, [editingParagraph, filePath, loadDocument])

  // Clear text selection when clicking outside the container (and outside the floating toolbar)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      const toolbar = toolbarRef.current
      if (toolbar && toolbar.contains(target)) return
      if (!container.contains(target)) {
        setSelectedText('')
        setToolbarPos(null)
        setSelectedParagraphs(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Watch external edits (system default editor, agent tools, fs:undoWrite)
  useEffect(() => {
    if (!filePath) return
    window.electronAPI.wordWatchExternal(filePath)
    const unsubWord = window.electronAPI.onWordExternalChanged((changedPath) => {
      if (changedPath === filePath && !isSavingRef.current) {
        loadDocument()
      }
    })
    const unsubFs = window.electronAPI.onFileChanged((event) => {
      if (event.path === filePath && !isSavingRef.current) {
        loadDocument()
      }
    })
    return () => {
      unsubWord()
      unsubFs()
      window.electronAPI.wordUnwatchExternal(filePath)
    }
  }, [filePath, loadDocument])

  // Poll undo availability (multi-step undo via SQLite)
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
        const result = await window.electronAPI.undoWriteFile(filePath)
        if (result.success) {
          toast.success('已撤销')
          loadDocument()
          const countRes = await window.electronAPI.getUndoCount(filePath)
          setCanUndo(countRes.count > 0)
        } else {
          toast.error('撤销失败: ' + (result.error || '未知错误'))
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [filePath, canUndo, loadDocument])

  // Load document structure when panel opens
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
      {/* Hidden style container for docx-preview injected styles */}
      <div ref={styleContainerRef} style={{ display: 'none' }} />

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
        </div>

        <div className="flex items-center gap-1">
          {canUndo && (
            <button
              onClick={async () => {
                const result = await window.electronAPI.undoWriteFile(filePath)
                if (result.success) {
                  toast.success('已撤销')
                  loadDocument()
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
          <button
            onClick={() => window.electronAPI.wordOpenExternally(filePath)}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
            title="用系统默认程序打开"
          >
            <ExternalLink className="w-3 h-3" />
            打开
          </button>
          <button
            onClick={() => setShowStructure((s) => !s)}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={showStructure ? activeBtnStyle : inactiveBtnStyle}
            title="文档结构"
          >
            <List className="w-3 h-3" />
            结构
          </button>
          <button
            onClick={() => loadDocument()}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors"
            style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
            title="刷新预览"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            刷新
          </button>
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
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('word:jump-to-line', {
                        detail: { line: item.lineStart, endLine: item.lineEnd }
                      }))
                    }, 300)
                  }
                } catch (e: any) {
                  setError(e.message || '解压失败')
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

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        <div className="h-full overflow-auto">
          {/* Main rendering container — ALWAYS mounted */}
          <div
            ref={containerRef}
            className="py-8 px-4"
            style={{
              background: isDark ? '#141414' : '#fff',
              color: isDark ? '#d0d0d0' : 'inherit',
              minHeight: '100%',
              display: 'table',
              minWidth: '100%',
            }}
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
                const container = containerRef.current
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
        </div>

        {/* Loading overlay */}
        {isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: 'var(--na-bg-panel)' }}
          >
            <Loader2 className="w-5 h-5 animate-spin mr-2" style={{ color: 'var(--na-text-tertiary)' }} />
            <span className="text-sm" style={{ color: 'var(--na-text-tertiary)' }}>加载文档...</span>
          </div>
        )}

        {/* Error overlay */}
        {error && !isLoading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10"
            style={{ background: 'var(--na-bg-panel)' }}
          >
            <div className="flex items-center gap-2" style={{ color: 'var(--na-status-explore)' }}>
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
            <button
              onClick={() => loadDocument()}
              className="flex items-center gap-1 px-3 py-1 text-[11px] rounded transition-colors"
              style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          </div>
        )}

        {/* Context menu */}
        {contextMenu?.visible && (
          <div
            className="fixed z-[200] flex flex-col gap-0.5 py-1 rounded-md shadow-lg word-context-menu"
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
              onClick={() => { loadDocument(); setContextMenu(null) }}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
              style={{ color: 'var(--na-text-secondary)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新预览
            </button>
            <button
              onClick={() => { window.electronAPI.wordOpenExternally(filePath); setContextMenu(null) }}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors hover:bg-[var(--na-bg-hover)]"
              style={{ color: 'var(--na-text-secondary)' }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              用系统默认程序打开
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
