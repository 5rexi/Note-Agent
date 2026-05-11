import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAtom, useAtomValue } from 'jotai'
import { editorStateAtom, currentFilePathAtom, currentWorkspaceAtom, currentTaskAtom, themeAtom } from '../atoms'
import { toast } from 'sonner'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Delayed Markdown preview: renders on next frame so Monaco isn't blocked
function MarkdownPreview({ content }: { content: string }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    let timerId: ReturnType<typeof setTimeout> | null = null
    // Defer to next frame — lets Monaco paint first
    const rafId = requestAnimationFrame(() => {
      const delay = content.length > 50000 ? 150 : 0
      timerId = setTimeout(() => setReady(true), delay)
    })
    return () => {
      cancelAnimationFrame(rafId)
      if (timerId) clearTimeout(timerId)
    }
  }, [content])

  if (!content) {
    return <div className="text-sm" style={{ color: 'var(--na-text-tertiary)' }}>预览将在这里显示</div>
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: 'var(--na-text-tertiary)' }}>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm">渲染预览...</span>
      </div>
    )
  }

  // Disable expensive syntax highlighting for very large files
  const isLarge = content.length > 100000
  const rehypePlugins = isLarge ? [] : [rehypeHighlight]

  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
import {
  FileCode, Eye, LayoutTemplate, Save, X, Terminal, Play, Bug, RefreshCw,
  Loader2, Square, ChevronUp, Undo, Quote, Wrench,
} from 'lucide-react'
import ImageViewer from './file-viewers/ImageViewer'
import LaTeXViewer from './file-viewers/LaTeXViewer'
import UnsupportedViewer from './file-viewers/UnsupportedViewer'
import { viewerRegistry } from './file-viewers/registry'
import { type FileKind, type FileTypeInfo, FILE_TYPE_MAP, getFileInfo } from './file-viewers/file-types'

// (FileKind, FileTypeInfo, FILE_TYPE_MAP, getFileInfo now live in ./file-viewers/file-types)

export default function FileEditor() {
  const [editorState, setEditorState] = useAtom(editorStateAtom)
  const currentFile = useAtomValue(currentFilePathAtom)
  const workspace = useAtomValue(currentWorkspaceAtom)
  const task = useAtomValue(currentTaskAtom)
  const theme = useAtomValue(themeAtom)
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editorFontSize, setEditorFontSize] = useState(14)
  const [editorFontFamily, setEditorFontFamily] = useState('"JetBrains Mono", "SF Mono", "Fira Code", "Consolas", "Courier New", "Segoe UI Mono", monospace')
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [forceTextMode, setForceTextMode] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
  const currentFileRef = useRef(currentFile)
  const workspaceRef = useRef(workspace)
  const isProgrammaticChange = useRef(false)
  const loadAbortRef = useRef<AbortController | null>(null)

  // Keep refs in sync to avoid stale closures in Monaco actions
  useEffect(() => { currentFileRef.current = currentFile }, [currentFile])
  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  const [latexEnabled, setLatexEnabled] = useState(false)
  const wordUnpackMap = useRef<Map<string, string>>(new Map()) // unpackDir -> original docx path

  // Load LaTeX enabled state
  useEffect(() => {
    window.electronAPI.getSetting('latexSupport').then((raw) => {
      if (raw) {
        try { setLatexEnabled(JSON.parse(raw).enabled === true) } catch { setLatexEnabled(false) }
      } else {
        setLatexEnabled(false)
      }
    })
  }, [currentFile])

  // Listen for word unpack events (edit XML mode)
  useEffect(() => {
    const handler = (e: any) => {
      const { unpackDir, originalPath } = e.detail
      if (unpackDir && originalPath) {
        wordUnpackMap.current.set(unpackDir, originalPath)
      }
    }
    window.addEventListener('word:edit-xml', handler)
    return () => window.removeEventListener('word:edit-xml', handler)
  }, [])

  // Listen for word jump-to-line events (structure navigation)
  useEffect(() => {
    const handler = (e: any) => {
      const { line, endLine } = e.detail
      const editor = monacoRef.current
      if (editor && line != null) {
        const startLine = Math.max(1, line + 1)
        const targetEndLine = endLine != null ? Math.max(1, endLine + 1) : startLine
        editor.revealLineInCenter(startLine)
        editor.setPosition({ lineNumber: startLine, column: 1 })
        // Highlight the range
        const decorations = editor.deltaDecorations([], [
          {
            range: new monaco.Range(startLine, 1, targetEndLine, 1),
            options: {
              isWholeLine: true,
              className: 'word-structure-highlight',
              overviewRuler: { color: 'var(--na-accent)', position: monaco.editor.OverviewRulerLane.Full },
            },
          },
        ])
        // Remove highlight after 3 seconds
        setTimeout(() => {
          editor.deltaDecorations(decorations, [])
        }, 3000)
      }
    }
    window.addEventListener('word:jump-to-line', handler)
    return () => window.removeEventListener('word:jump-to-line', handler)
  }, [])

  // Check undo availability for current file (multi-step undo via SQLite)
  useEffect(() => {
    if (!currentFile) return
    const fullPath = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace?.path || '', currentFile)
    if (!fullPath) return
    // Undo is available for all file types that have history in the database.
    // Binary files (word/pdf/etc.) are handled by fs:undoWrite via base64 decode.
    const checkUndo = () => {
      window.electronAPI.getUndoCount(fullPath)
        .then((r) => setCanUndo(r.count > 0))
        .catch(() => setCanUndo(false))
    }
    checkUndo()
    const timer = setInterval(checkUndo, 3000)
    return () => clearInterval(timer)
  }, [currentFile, workspace])

  // Ctrl+Z undo shortcut for file changes (app-level multi-step undo)
  useEffect(() => {
    if (!currentFile) return
    const fullPath = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace?.path || '', currentFile)
    if (!fullPath) return
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // Skip undo for binary files (they're handled by their own viewers)
        const fileKind = getFileInfo(currentFile).kind
        if (['word', 'excel', 'ppt', 'pdf', 'image'].includes(fileKind)) return
        e.preventDefault()
        // Always try app-level undo first
        const result = await window.electronAPI.undoWriteFile(fullPath)
        if (result.success) {
          toast.success('已撤销')
          // Reload content without referencing loadFileContent (TDZ)
          const readResult = await window.electronAPI.readFile(fullPath)
          if (!readResult.error) {
            const clean = readResult.content.replace(/^\uFEFF/, '')
            setContent(clean)
            setIsDirty(false)
          }
          // Refresh undo count
          const countRes = await window.electronAPI.getUndoCount(fullPath)
          setCanUndo(countRes.count > 0)
        } else {
          // If no app history, fall back to Monaco's native undo
          const editor = monacoRef.current
          if (editor) {
            editor.trigger('keyboard', 'undo', null)
          }
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [currentFile, workspace, canUndo])

  // Background tasks
  const [bgTasks, setBgTasks] = useState<Array<{ id: string; name: string; status: string; progress?: number }>>([])
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  const taskBtnRef = useRef<HTMLButtonElement>(null)
  const [taskPanelPos, setTaskPanelPos] = useState<{ bottom: number; right: number } | null>(null)

  useEffect(() => {
    const syncTasks = () => {
      window.electronAPI.taskList().then((list: any[]) => {
        const running = list.filter((t) => t.status === 'running' || t.status === 'pending')
        setBgTasks(running)
      })
    }
    syncTasks()
    // Poll every 3s as a fallback in case events are missed
    const interval = setInterval(syncTasks, 3000)

    const unsubProgress = window.electronAPI.onTaskProgress((taskId, progress) => {
      setBgTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress } : t))
      )
    })
    const unsubCompleted = window.electronAPI.onTaskCompleted((taskId) => {
      setBgTasks((prev) => prev.filter((t) => t.id !== taskId))
    })
    const unsubFailed = window.electronAPI.onTaskFailed((taskId) => {
      setBgTasks((prev) => prev.filter((t) => t.id !== taskId))
    })
    const unsubCreated = window.electronAPI.onTaskCreated((task) => {
      if (task.status === 'running' || task.status === 'pending') {
        setBgTasks((prev) => {
          if (prev.some((t) => t.id === task.id)) return prev
          return [...prev, task]
        })
      }
    })
    return () => {
      clearInterval(interval)
      unsubProgress()
      unsubCompleted()
      unsubFailed()
      unsubCreated()
    }
  }, [])

  const fileInfo = getFileInfo(currentFile)
  const isMarkdown = fileInfo.kind === 'markdown'
  const isLatexRaw = fileInfo.kind === 'latex'
  const isLatex = isLatexRaw && latexEnabled
  const supportsSplitView = isMarkdown || isLatex

  // Determine effective kind (for unknown files, forceTextMode shows code editor)
  // When LaTeX is disabled, .tex files fall back to plain code editing
  const effectiveKind = forceTextMode ? 'code' : (isLatexRaw && !latexEnabled ? 'code' : fileInfo.kind)

  // Three-state view: edit | split | preview (for markdown and latex)
  const view = editorState.editorView ?? 'edit'
  const setView = (v: 'edit' | 'split' | 'preview') => setEditorState((s) => ({ ...s, editorView: v }))
  const cycleView = () => {
    const order: Array<'edit' | 'split' | 'preview'> = ['edit', 'split', 'preview']
    const idx = order.indexOf(view)
    setView(order[(idx + 1) % order.length])
  }

  // Load editor config (font + size) from settings
  const reloadEditorConfig = useCallback(async () => {
    const saved = await window.electronAPI.getSetting('appearanceConfig')
    if (saved) {
      try {
        const config = JSON.parse(saved)
        const size = config.editorFontSize ?? 14
        const family = editorFontMap[config.editorFont as keyof typeof editorFontMap] ?? '"JetBrains Mono", "SF Mono", "Fira Code", monospace'
        setEditorFontSize(size)
        setEditorFontFamily(family)
        editorRef.current?.updateOptions({ fontSize: size, fontFamily: family })
      } catch {}
    }
  }, [])

  useEffect(() => {
    reloadEditorConfig()
    const handler = () => reloadEditorConfig()
    window.addEventListener('settings:changed', handler)
    return () => window.removeEventListener('settings:changed', handler)
  }, [reloadEditorConfig])

  const saveFile = useCallback(async () => {
    if (!currentFile || !isDirty) return
    const currentContent = content
    setSaveIndicator('saving')
    const fullPath = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace?.path || '', currentFile)
    const result = await window.electronAPI.writeFile(fullPath, currentContent)
    if (result.error) {
      toast.error('保存失败: ' + result.error)
      setSaveIndicator('idle')
      return
    }
    setIsDirty(false)
    setSaveIndicator('saved')
    setTimeout(() => setSaveIndicator('idle'), 3000)

    // Check if this file is part of an unpacked docx — auto repack
    let checkDir = fullPath
    for (let i = 0; i < 10; i++) {
      const parentDir = window.electronAPI.pathDirname(checkDir)
      if (parentDir === checkDir) break
      checkDir = parentDir
      const originalPath = wordUnpackMap.current.get(checkDir)
      if (originalPath) {
        const packResult = await window.electronAPI.wordPack(checkDir)
        if (packResult.success) {
          toast.success('Word 文档已重新打包')
        } else {
          toast.error('Word 打包失败: ' + packResult.error)
        }
        break
      }
    }
  }, [currentFile, workspace, isDirty, content])

  useEffect(() => {
    if (!isDirty) return
    setSaveIndicator('idle')
    const timer = setTimeout(() => saveFile(), 3000)
    return () => clearTimeout(timer)
  }, [content, isDirty, saveFile])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  const loadFileContent = useCallback(async (filePath: string) => {
    if (!workspace) return
    const fullPath = window.electronAPI.pathIsAbsolute(filePath) ? filePath : window.electronAPI.pathJoin(workspace.path, filePath)
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    try {
      const result = await window.electronAPI.readFile(fullPath)
      if (controller.signal.aborted) return
      const clean = result.error ? '' : result.content.replace(/^\uFEFF/, '')
      setContent(clean)
      setIsDirty(false)
      // Removed snapshotBackup here — baseline should only be created on first save,
      // not on every file open, so the undo button isn't lit immediately.

      // Monaco content sync is handled by the `value` prop on the Editor component.
      // We no longer manually call model.setValue() here to avoid race conditions
      // where Monaco hasn't created the model yet when loadFileContent runs.
    } catch {
      // ignore
    }
  }, [workspace])

  useEffect(() => {
    const handler = (e: any) => {
      const filePath = e.detail
      if (filePath) openFile(filePath)
    }
    window.addEventListener('file-tree:open', handler)
    window.addEventListener('file-tree:open-absolute', handler)
    return () => {
      window.removeEventListener('file-tree:open', handler)
      window.removeEventListener('file-tree:open-absolute', handler)
    }
  }, [])

  // Auto-reload when file is changed externally, and close tab when deleted
  useEffect(() => {
    const unsub = window.electronAPI.onFileChanged(async (event) => {
      if (!currentFile || !workspace) return
      const fullPath = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace.path, currentFile)
      if (event.path !== fullPath) return
      if (isDirty) {
        toast.info('文件已被外部修改，请保存或放弃当前更改')
        return
      }
      loadFileContent(currentFile)
    })
    return () => unsub()
  }, [currentFile, workspace, isDirty, loadFileContent])

  // Refresh current file when undo-all is triggered
  useEffect(() => {
    const handler = () => {
      if (currentFile && workspace) {
        loadFileContent(currentFile)
      }
    }
    window.addEventListener('file:refresh-all', handler)
    return () => window.removeEventListener('file:refresh-all', handler)
  }, [currentFile, workspace, loadFileContent])

  // Close tab when file is deleted from file tree
  useEffect(() => {
    const handler = (e: Event) => {
      const deletedPath = (e as CustomEvent).detail?.path
      if (!deletedPath) return
      setEditorState((s) => {
        const idx = s.openFiles.indexOf(deletedPath)
        if (idx === -1) return s
        const newFiles = s.openFiles.filter((f) => f !== deletedPath)
        const newIndex = Math.min(s.activeFileIndex, newFiles.length - 1)
        return { ...s, openFiles: newFiles, activeFileIndex: Math.max(0, newIndex) }
      })
    }
    window.addEventListener('file:deleted', handler)
    return () => window.removeEventListener('file:deleted', handler)
  }, [])

  useEffect(() => {
    if (task?.editor_state) {
      try {
        const state = JSON.parse(task.editor_state)
        if (state.openFiles?.length > 0) {
          setEditorState((s) => ({
            ...s,
            openFiles: state.openFiles,
            activeFileIndex: state.activeFileIndex ?? 0,
          }))
        }
      } catch {}
    }
  }, [task?.id])

  const closeTab = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    setEditorState((s) => {
      const newFiles = s.openFiles.filter((_, i) => i !== idx)
      const newIndex = Math.min(s.activeFileIndex, newFiles.length - 1)
      return { ...s, openFiles: newFiles, activeFileIndex: Math.max(0, newIndex) }
    })
  }

  const openFile = (filePath: string) => {
    setEditorState((s) => {
      if (s.openFiles.includes(filePath)) {
        return { ...s, activeFileIndex: s.openFiles.indexOf(filePath) }
      }
      return { ...s, openFiles: [...s.openFiles, filePath], activeFileIndex: s.openFiles.length }
    })
  }

  // Load / reload file content on tab change
  useLayoutEffect(() => {
    setForceTextMode(false)
    setIsDirty(false)
    if (currentFile) {
      const info = getFileInfo(currentFile)
      const isBinary = info.kind === 'image' || info.kind === 'pdf' || info.kind === 'word' || info.kind === 'excel' || info.kind === 'ppt'
      if (!isBinary) {
        loadFileContent(currentFile)
      }
    }
  }, [currentFile, workspace, loadFileContent])

  const handleEditorMount = (editor: any, monacoInstance: any) => {
    monacoRef.current = monacoInstance
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column })
    })
    // Load current file content if editor is ready but content hasn't been synced yet
    if (currentFileRef.current && workspaceRef.current) {
      const fullPath = window.electronAPI.pathIsAbsolute(currentFileRef.current) ? currentFileRef.current : window.electronAPI.pathJoin(workspaceRef.current.path, currentFileRef.current)
      const model = editor.getModel()
      if (model && model.getValue() === '' && content) {
        isProgrammaticChange.current = true
        editor.setValue(content)
        isProgrammaticChange.current = false
      }
    }

    // Apply current config
    reloadEditorConfig()

    // Register context menu actions for text selection
    editor.addAction({
      id: 'na-quote-to-chat',
      label: '引用到对话',
      contextMenuGroupId: 'na_actions',
      contextMenuOrder: 1,
      precondition: 'editorHasSelection',
      run: (ed: any) => {
        const cf = currentFileRef.current
        const ws = workspaceRef.current
        if (!cf || !ws) return
        const fullPath = window.electronAPI.pathIsAbsolute(cf) ? cf : window.electronAPI.pathJoin(ws.path, cf)
        const fileName = window.electronAPI.pathBasename(cf)
        const sel = ed.getSelection()
        const selectedText = ed.getModel()?.getValueInRange(sel) || ''
        const fi = getFileInfo(cf)
        const detail = {
          type: fi.kind === 'markdown' ? 'markdown' : fi.kind === 'latex' ? 'latex' : 'code',
          filePath: fullPath,
          fileName,
          selectedText,
          range: {
            startLine: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLine: sel.endLineNumber,
            endColumn: sel.endColumn,
          },
        }
        window.dispatchEvent(new CustomEvent('editor:text-selected', { detail }))
      },
    })
    editor.addAction({
      id: 'na-replace-selection',
      label: '替换选中内容...',
      contextMenuGroupId: 'na_actions',
      contextMenuOrder: 2,
      precondition: 'editorHasSelection',
      run: (ed: any) => {
        const sel = ed.getSelection()
        const selectedText = ed.getModel()?.getValueInRange(sel) || ''
        const replacement = window.prompt('替换为：', selectedText)
        if (replacement !== null) {
          ed.executeEdits('replace-selection', [{
            range: new monacoInstance.Range(sel.startLineNumber, sel.startColumn, sel.endLineNumber, sel.endColumn),
            text: replacement,
          }])
        }
      },
    })

    // Ctrl + wheel zoom — bind directly to editor DOM node with capture
    // to intercept before Monaco's own scroll handler (especially on Windows)
    const wheelHandler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.getModifierState('Control')) {
        e.preventDefault()
        e.stopPropagation()
        const currentSize = editor.getOption(monacoRef.current.editor.EditorOption.fontSize)
        const delta = e.deltaY > 0 ? -1 : 1
        const newSize = Math.max(8, Math.min(32, currentSize + delta))
        editor.updateOptions({ fontSize: newSize })
        setEditorFontSize(newSize)
        syncFontSizeToSettings(newSize)
      }
    }
    const editorDom = editor.getDomNode()
    if (editorDom) {
      editorDom.addEventListener('wheel', wheelHandler, { passive: false, capture: true })
    }

    // Store cleanup on editor instance for unmount
    ;(editor as any).__editorCleanup = () => {
      if (editorDom) {
        editorDom.removeEventListener('wheel', wheelHandler, { capture: true })
      }
    }

  }

  const handleEditorChange = (value: string | undefined) => {
    if (isProgrammaticChange.current) return
    setContent(value || '')
    setIsDirty(true)
  }

  const syncFontSizeToSettings = async (size: number) => {
    try {
      const saved = await window.electronAPI.getSetting('appearanceConfig')
      const config = saved ? JSON.parse(saved) : {}
      config.editorFontSize = size
      await window.electronAPI.setSetting('appearanceConfig', JSON.stringify(config))
    } catch {}
  }

  const handleRefresh = useCallback(async () => {
    if (!currentFile || !workspace) return
    if (isDirty) {
      toast.info('当前文件有未保存更改，请先保存或放弃')
      return
    }
    loadFileContent(currentFile)
    toast.success('文件已刷新')
  }, [currentFile, workspace, isDirty, loadFileContent])

  // Tools based on file type
  const renderTools = () => {
    const tools: JSX.Element[] = []

    if (supportsSplitView) {
      const viewLabels = { edit: '编辑', split: '分屏', preview: '预览' }
      const ViewIcon = view === 'edit' ? Eye : view === 'split' ? LayoutTemplate : Eye
      tools.push(
        <button
          key="view-toggle"
          onClick={cycleView}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
          style={{ color: view !== 'edit' ? 'var(--na-accent)' : 'var(--na-text-tertiary)', borderRadius: 'var(--na-radius-sm)', background: view !== 'edit' ? 'var(--na-accent-soft)' : 'transparent' }}
          title={`${viewLabels[view]} (点击切换)`}
        >
          <ViewIcon className="w-3.5 h-3.5" />
          {viewLabels[view]}
        </button>
      )
    }

    if (isLatex) {
      tools.push(
        <button
          key="latex-compile"
          onClick={async () => {
            const result = await window.electronAPI.latexCompile(fullPath)
            if (result.error) {
              toast.error('编译失败: ' + result.error)
            } else {
              toast.success('编译成功')
            }
          }}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
          style={{ color: 'var(--na-status-ask)', borderRadius: 'var(--na-radius-sm)', background: 'rgba(5,150,105,0.08)' }}
          title="编译 LaTeX"
        >
          <Play className="w-3 h-3" />
          编译
        </button>
      )
    }

    if (['py', 'js', 'ts', 'jsx', 'tsx', 'rs', 'go'].includes(fileInfo.ext)) {
      tools.push(
        <button
          key="run"
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
          style={{ color: 'var(--na-status-ask)', borderRadius: 'var(--na-radius-sm)', background: 'rgba(5,150,105,0.08)' }}
          title="运行"
        >
          <Play className="w-3 h-3" />
          运行
        </button>
      )
      if (fileInfo.ext === 'py') {
        tools.push(
          <button
            key="debug"
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
            style={{ color: 'var(--na-status-explore)', borderRadius: 'var(--na-radius-sm)', background: 'rgba(37,99,235,0.08)' }}
            title="调试"
          >
            <Bug className="w-3 h-3" />
            调试
          </button>
        )
      }
    }

    return tools
  }

  const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs'
  const fullPath = currentFile && workspace
    ? (window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace.path, currentFile))
    : ''

  const renderContent = () => {
    const showPreview = supportsSplitView && (view === 'split' || view === 'preview')
    const showEditor = !supportsSplitView || view === 'edit' || view === 'split'
    const isCodeLayerActive = effectiveKind === 'markdown' || effectiveKind === 'code' || effectiveKind === 'latex'

    return (
      <div className="relative h-full w-full">
        {/* ===== Code editor layer — ALWAYS MOUNTED, always rendering ===== */}
        <div
          className="absolute inset-0 flex"
          style={{
            zIndex: isCodeLayerActive ? 1 : 0,
            pointerEvents: isCodeLayerActive ? 'auto' : 'none',
          }}
        >
          {/* Monaco editor */}
          <div
            className="min-w-0"
            style={{
              flex: showEditor ? 1 : 0,
              width: !showEditor ? 0 : undefined,
              overflow: 'hidden',
            }}
          >
            <Editor
              height="100%"
              path={fullPath}
              language={fileInfo.lang}
              defaultValue={''}
              value={content}
              theme={monacoTheme}
              loading={
                <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              }
              options={{
                minimap: { enabled: false },
                fontSize: editorFontSize,
                fontFamily: editorFontFamily,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                padding: { top: 16 },
                unicodeHighlight: { invisibleCharacters: false, ambiguousCharacters: false },
              }}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
            />
          </div>

          {/* Preview panel (markdown / latex) */}
          {showPreview && (
            <div
              className="overflow-auto"
              style={{
                flex: view === 'split' ? '0 0 45%' : 1,
                width: view === 'split' ? undefined : undefined,
                borderLeft: view === 'split' ? '1px solid var(--na-border-subtle)' : 'none',
                background: 'var(--na-bg-panel)',
              }}
            >
              {isMarkdown && (
                <div className="p-6">
                  <MarkdownPreview content={content} />
                </div>
              )}
              {isLatex && (
                <LaTeXViewer filePath={fullPath} />
              )}
            </div>
          )}
        </div>

        {/* ===== Empty state layer ===== */}
        {!currentFile && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" style={{ background: 'var(--na-bg-panel)' }}>
            <FileCode className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--na-text-tertiary)' }}>从文件树选择一个文件开始编辑</p>
            <p className="text-xs mt-1 opacity-60" style={{ color: 'var(--na-text-tertiary)' }}>支持 Markdown、代码、图片、PDF 等</p>
          </div>
        )}

        {/* ===== Document/binary viewer layer (driven by viewerRegistry) ===== */}
        {(() => {
          const Viewer = viewerRegistry[effectiveKind]
          if (!Viewer) return null
          return (
            <div className="absolute inset-0 z-10" style={{ background: 'var(--na-bg-panel)' }}>
              <Viewer
                filePath={fullPath}
                ext={fileInfo.ext}
                fileName={window.electronAPI.pathBasename(currentFile)}
              />
            </div>
          )
        })()}

        {/* ===== Unsupported file layer ===== */}
        {effectiveKind === 'unknown' && (
          <div className="absolute inset-0 z-10 flex flex-col" style={{ background: 'var(--na-bg-panel)' }}>
            <UnsupportedViewer
              fileName={window.electronAPI.pathBasename(currentFile)}
              ext={fileInfo.ext}
              onViewAsText={() => setForceTextMode(true)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      {/* Tab Bar */}
      <div
        className="flex items-center justify-between shrink-0 px-2"
        style={{
          height: 42,
          borderBottom: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-1 overflow-hidden flex-1">
          {editorState.openFiles.length === 0 ? (
            <span className="text-[11px] px-2" style={{ color: 'var(--na-text-tertiary)' }}>
              无打开文件
            </span>
          ) : (
            editorState.openFiles.map((path, idx) => {
              const isActive = idx === editorState.activeFileIndex
              const fileName = window.electronAPI.pathBasename(path)
              return (
                <button
                  key={path}
                  onClick={() => setEditorState((s) => ({ ...s, activeFileIndex: idx }))}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-all shrink-0 max-w-[160px]"
                  style={{
                    borderRadius: 'var(--na-radius-sm)',
                    background: isActive ? 'var(--na-bg-panel)' : 'transparent',
                    color: isActive ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)',
                    boxShadow: isActive ? 'var(--na-shadow-sm)' : 'none',
                  }}
                >
                  <FileCode className="w-3 h-3 shrink-0" />
                  <span className="truncate">{fileName}</span>
                  {idx === editorState.activeFileIndex && isDirty && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--na-status-execute)' }} />
                  )}
                  <span
                    onClick={(e) => closeTab(e, idx)}
                    className="ml-0.5 p-0.5 rounded-sm opacity-0 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--na-text-tertiary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--na-bg-hover)'; e.currentTarget.style.opacity = '1' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0' }}
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {effectiveKind !== 'word' && (
            <button
              key="undo"
              disabled={!canUndo}
              onClick={async () => {
                const fullPath = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(workspace?.path || '', currentFile)
                if (!fullPath) return
                const result = await window.electronAPI.undoWriteFile(fullPath)
                if (result.success) {
                  toast.success('已撤销')
                  const fileKind = getFileInfo(currentFile).kind
                  if (['word', 'excel', 'ppt', 'pdf', 'image'].includes(fileKind)) {
                    // Binary files: no Monaco model to update; the file-watcher will
                    // notify other viewers (WordViewer, etc.) to refresh.
                  } else {
                    const readResult = await window.electronAPI.readFile(fullPath)
                    if (!readResult.error) {
                      const clean = readResult.content.replace(/^\uFEFF/, '')
                      setContent(clean)
                      // Sync Monaco editor model so the cursor view updates immediately
                      if (editorRef.current && monacoRef.current) {
                        const model = editorRef.current.getModel()
                        const expectedUri = monacoRef.current.Uri.file(fullPath).toString()
                        if (model && model.uri.toString() === expectedUri) {
                          isProgrammaticChange.current = true
                          model.setValue(clean)
                          isProgrammaticChange.current = false
                        }
                      }
                    }
                  }
                  const countRes = await window.electronAPI.getUndoCount(fullPath)
                  setCanUndo(countRes.count > 0)
                } else {
                  toast.error('撤销失败: ' + (result.error || '未知错误'))
                }
              }}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
              style={{
                color: canUndo ? '#ef4444' : 'var(--na-text-tertiary)',
                opacity: canUndo ? 1 : 0.5,
                borderRadius: 'var(--na-radius-sm)',
                cursor: canUndo ? 'pointer' : 'not-allowed',
              }}
              title="撤销上次保存的修改 (Ctrl+Z)"
            >
              <Undo className="w-3.5 h-3.5" />
              撤销
            </button>
          )}
          {currentFile && effectiveKind !== 'unknown' && effectiveKind !== 'image' && effectiveKind !== 'pdf' && effectiveKind !== 'word' && effectiveKind !== 'excel' && effectiveKind !== 'ppt' && (
            <button
              key="refresh"
              onClick={handleRefresh}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors hover:opacity-80"
              style={{ color: 'var(--na-text-tertiary)', borderRadius: 'var(--na-radius-sm)' }}
              title="刷新文件内容"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
          )}
          {renderTools()}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>

      {/* Status Bar */}
      <div
        className="flex items-center justify-between shrink-0 px-3"
        style={{
          height: 22,
          borderTop: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
          fontSize: 11,
          color: 'var(--na-text-tertiary)',
          fontFamily: 'var(--na-font-mono)',
        }}
      >
        <div className="flex items-center gap-3">
          <span>{fileInfo.label || '文本'}</span>
          <span>UTF-8</span>
          {fileInfo.ext === 'py' && <span>venv: default</span>}
          {(effectiveKind === 'code' || effectiveKind === 'markdown') && (
            <span style={{ color: 'var(--na-text-secondary)' }}>行 {cursorPos.line}, 列 {cursorPos.column}</span>
          )}
          {(effectiveKind === 'image' || effectiveKind === 'pdf') && (
            <span style={{ color: 'var(--na-text-secondary)' }}>{currentFile ? window.electronAPI.pathBasename(currentFile) : ''}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saveIndicator === 'saving' && <span style={{ color: 'var(--na-status-execute)' }}>保存中...</span>}
          {saveIndicator === 'saved' && <span>· 已自动保存</span>}

          {/* Background tasks */}
          {bgTasks.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                ref={taskBtnRef}
                onClick={() => {
                  if (!showTaskPanel && taskBtnRef.current) {
                    const rect = taskBtnRef.current.getBoundingClientRect()
                    setTaskPanelPos({
                      bottom: window.innerHeight - rect.top + 4,
                      right: window.innerWidth - rect.right,
                    })
                  }
                  setShowTaskPanel(!showTaskPanel)
                }}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors"
                style={{ background: 'var(--na-bg-active)' }}
              >
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--na-status-ask)' }} />
                <span style={{ color: 'var(--na-text-secondary)' }}>
                  {bgTasks.length > 1 ? `${bgTasks.length} 个任务` : bgTasks[0].name}
                </span>
                {/* Progress bar */}
                <div className="h-1 rounded-full overflow-hidden" style={{ width: 60, background: 'var(--na-bg-panel)' }}>
                  {bgTasks[0].progress !== undefined ? (
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${bgTasks[0].progress}%`, background: 'var(--na-status-ask)' }}
                    />
                  ) : (
                    <div
                      className="h-full rounded-full na-progress-indeterminate"
                      style={{
                        width: '30%',
                        background: 'linear-gradient(90deg, var(--na-status-ask), #34d399, var(--na-status-ask))',
                        backgroundSize: '200% 100%',
                      }}
                    />
                  )}
                </div>
                <ChevronUp className="w-3 h-3 transition-transform" style={{ transform: showTaskPanel ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--na-text-tertiary)' }} />
              </button>

              {/* Task panel popup - rendered via portal to escape overflow constraints */}
              {showTaskPanel && taskPanelPos && createPortal(
                <div
                  className="fixed rounded-lg overflow-hidden na-popover-appear"
                  style={{
                    bottom: taskPanelPos.bottom,
                    right: taskPanelPos.right,
                    width: 280,
                    background: 'var(--na-bg-panel)',
                    border: '1px solid var(--na-border-subtle)',
                    boxShadow: 'var(--na-shadow-md)',
                    zIndex: 9999,
                  }}
                >
                  <div className="px-3 py-2 text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)', borderBottom: '1px solid var(--na-border-subtle)' }}>
                    后台任务
                  </div>
                  <div className="max-h-[200px] overflow-auto">
                    {bgTasks.map((task) => (
                      <div key={task.id} className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--na-status-ask)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] truncate" style={{ color: 'var(--na-text-primary)' }}>{task.name}</div>
                          <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: 'var(--na-bg-sidebar)' }}>
                            {task.progress !== undefined ? (
                              <div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: 'var(--na-status-ask)' }} />
                            ) : (
                              <div className="h-full rounded-full na-progress-indeterminate" style={{ width: '30%', background: 'linear-gradient(90deg, var(--na-status-ask), #34d399, var(--na-status-ask))' }} />
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => window.electronAPI.taskStop(task.id)}
                          className="p-0.5 rounded hover:opacity-70 shrink-0"
                          style={{ color: 'var(--na-text-tertiary)' }}
                          title="取消"
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}

          <button
            className="p-0.5 rounded transition-colors hover:opacity-70"
            style={{ color: 'var(--na-text-tertiary)' }}
            title="终端 (Cmd+`)"
          >
            <Terminal className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

const editorFontMap = {
  'jetbrains-mono': '"JetBrains Mono", "Consolas", "Courier New", "Microsoft YaHei Mono", monospace',
  'sf-mono': '"SF Mono", "Consolas", "Courier New", "Microsoft YaHei Mono", monospace',
  'fira-code': '"Fira Code", "Consolas", "Courier New", "Microsoft YaHei Mono", monospace',
  'monospace': '"Consolas", "Courier New", "Microsoft YaHei Mono", monospace',
}
