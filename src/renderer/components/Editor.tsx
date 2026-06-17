import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { editorStateAtom, currentFilePathAtom, currentWorkspaceAtom, currentTaskAtom, themeAtom, outlineAtom, type OutlineItem } from '../atoms'
import { toast } from 'sonner'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'

// Delayed Markdown preview: renders on next frame so Monaco isn't blocked
/**
 * Rehype plugin: stamp block elements with `data-source-line` (the source line
 * they came from) so the preview can be scroll-synced by structure, not by %.
 */
function rehypeSourceLine() {
  const BLOCK = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'ul', 'ol', 'blockquote', 'table', 'hr', 'img'])
  return (tree: any) => {
    const walk = (node: any) => {
      if (node.type === 'element' && node.position?.start?.line && BLOCK.has(node.tagName)) {
        node.properties = node.properties || {}
        node.properties.dataSourceLine = node.position.start.line
      }
      if (node.children) for (const c of node.children) walk(c)
    }
    walk(tree)
  }
}

/** Register LaTeX/BibTeX syntax highlighting on Monaco (once). Monaco ships no
 *  LaTeX language, so .tex files render as plain text without this. */
let texLangRegistered = false
function registerTexLanguages(monaco: any) {
  if (texLangRegistered || !monaco?.languages) return
  if (monaco.languages.getLanguages().some((l: any) => l.id === 'latex')) { texLangRegistered = true; return }
  texLangRegistered = true

  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.ltx', '.cls', '.sty'], aliases: ['LaTeX', 'latex', 'tex'] })
  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\(begin|end)(\s*\{)([^}]*)(\})/, ['keyword.control', 'delimiter.curly', 'type.identifier', 'delimiter.curly']],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/\\[^a-zA-Z]/, 'keyword'],
        [/\$\$/, { token: 'string', next: '@displaymath' }],
        [/\$/, { token: 'string', next: '@math' }],
        [/[{}]/, 'delimiter.curly'],
        [/[[\]]/, 'delimiter.square'],
        [/[&~^_]/, 'operator'],
      ],
      math: [
        [/\$/, { token: 'string', next: '@pop' }],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/[^$\\]+/, 'string'],
        [/./, 'string'],
      ],
      displaymath: [
        [/\$\$/, { token: 'string', next: '@pop' }],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/[^$\\]+/, 'string'],
        [/./, 'string'],
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '$', close: '$' }],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '$', close: '$' }],
  })

  monaco.languages.register({ id: 'bibtex', extensions: ['.bib', '.bst'], aliases: ['BibTeX'] })
  monaco.languages.setMonarchTokensProvider('bibtex', {
    tokenizer: {
      root: [
        [/@[a-zA-Z]+/, 'keyword'],
        [/[a-zA-Z_][\w-]*(?=\s*=)/, 'attribute.name'],
        [/"/, { token: 'string', next: '@string' }],
        [/[{}]/, 'delimiter.curly'],
        [/%.*$/, 'comment'],
      ],
      string: [[/"/, { token: 'string', next: '@pop' }], [/[^"]+/, 'string']],
    },
  })
}

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
  const rehypePlugins = isLarge ? [rehypeKatex, rehypeSourceLine] : [rehypeHighlight, rehypeKatex, rehypeSourceLine]

  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={rehypePlugins as any}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
import {
  FileCode, Eye, LayoutTemplate, Save, X, Terminal, Play, Bug, RefreshCw,
  Loader2, Square, ChevronUp, Undo, Quote, Wrench, Link, ChevronDown, Check,
} from 'lucide-react'
import ImageViewer from './file-viewers/ImageViewer'
import LaTeXViewer from './file-viewers/LaTeXViewer'
import UnsupportedViewer from './file-viewers/UnsupportedViewer'
import TerminalPanel, { type TerminalPanelHandle } from './TerminalPanel'
import { viewerRegistry } from './file-viewers/registry'
import { type FileKind, type FileTypeInfo, FILE_TYPE_MAP, getFileInfo } from './file-viewers/file-types'
import { useEditorPreviewScrollSync } from '../hooks/useScrollSync'
import { useContextMenu } from './ui/ContextMenu'
import { Quote as QuoteIcon, Copy as CopyIcon } from 'lucide-react'

// (FileKind, FileTypeInfo, FILE_TYPE_MAP, getFileInfo now live in ./file-viewers/file-types)

/** Parse Markdown (#) or LaTeX (\chapter/\section/…) headings into an outline. */
function parseOutline(content: string, kind: string): OutlineItem[] {
  const lines = content.split('\n')
  const items: OutlineItem[] = []
  if (kind === 'markdown') {
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue }
      if (inFence) continue
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i])
      if (m) items.push({ id: `l${i + 1}`, title: m[2].trim(), level: m[1].length, line: i + 1 })
    }
  } else if (kind === 'latex') {
    const levelMap: Record<string, number> = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 }
    for (let i = 0; i < lines.length; i++) {
      const m = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{(.+?)\}/.exec(lines[i])
      if (!m) continue
      if (lines[i].slice(0, m.index).includes('%')) continue // commented out
      const title = m[2].replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}]/g, '').trim() || m[2].trim()
      items.push({ id: `l${i + 1}`, title, level: levelMap[m[1]] ?? 2, line: i + 1 })
    }
  }
  return items
}

export default function FileEditor() {
  const [editorState, setEditorState] = useAtom(editorStateAtom)
  const setOutline = useSetAtom(outlineAtom)
  const outlineItemsRef = useRef<OutlineItem[]>([])
  const currentFile = useAtomValue(currentFilePathAtom)
  const workspace = useAtomValue(currentWorkspaceAtom)
  const task = useAtomValue(currentTaskAtom)
  const theme = useAtomValue(themeAtom)
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [wordSaveStatus, setWordSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [editorFontSize, setEditorFontSize] = useState(14)
  const [editorFontFamily, setEditorFontFamily] = useState('"JetBrains Mono", "SF Mono", "Fira Code", "Consolas", "Courier New", "Segoe UI Mono", monospace')
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [forceTextMode, setForceTextMode] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)
  const currentFileRef = useRef(currentFile)
  const workspaceRef = useRef(workspace)
  const editorStateRef = useRef(editorState)
  const isProgrammaticChange = useRef(false)
  const loadAbortRef = useRef<AbortController | null>(null)
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [syncScrollEnabled, setSyncScrollEnabled] = useState(editorState.syncScrollEnabled ?? false)
  // Resizable split: preview pane width as a % of the editor area (drag to adjust).
  const [previewWidth, setPreviewWidth] = useState(45)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const previewCtx = useContextMenu()
  const monacoCtx = useContextMenu()
  const [terminalVisible, setTerminalVisible] = useState(false)
  const [terminalPosition, setTerminalPosition] = useState<'top' | 'bottom'>('bottom')
  const terminalPanelRef = useRef<TerminalPanelHandle>(null)
  const pythonLspRef = useRef<{
    workspacePath: string | null
    lspReady: boolean
    completionDisposable: any
    hoverDisposable: any
    diagnosticsUnsub: (() => void) | null
  } | null>(null)
  const [pythonEnvInfo, setPythonEnvInfo] = useState<{ type: string; pythonPath: string | null } | null>(null)
  const [availablePythonEnvs, setAvailablePythonEnvs] = useState<Array<{ id: string; label: string; type: string; pythonPath: string | null }>>([])
  const [selectedPythonEnvId, setSelectedPythonEnvId] = useState<string | null>(null)
  const [showPythonDropdown, setShowPythonDropdown] = useState(false)
  const pythonEnvBtnRef = useRef<HTMLButtonElement>(null)
  const pythonDropdownRef = useRef<HTMLDivElement>(null)

  // Close Python env dropdown on click outside
  useEffect(() => {
    if (!showPythonDropdown) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        pythonEnvBtnRef.current?.contains(target) ||
        pythonDropdownRef.current?.contains(target)
      ) {
        return
      }
      setShowPythonDropdown(false)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showPythonDropdown])

  // Keep refs in sync to avoid stale closures in Monaco actions
  useEffect(() => { currentFileRef.current = currentFile }, [currentFile])

  // Produce the document outline for md/latex (chapter menu). Other kinds are
  // cleared here; .docx is handled by WordViewer.
  useEffect(() => {
    const kind = currentFile ? getFileInfo(currentFile).kind : ''
    if (kind !== 'markdown' && kind !== 'latex') {
      outlineItemsRef.current = []
      setOutline({ items: [], activeId: null })
      return
    }
    const timer = setTimeout(() => {
      const items = parseOutline(content, kind)
      outlineItemsRef.current = items
      setOutline((o) => {
        const keep = o.activeId && items.some((i) => i.id === o.activeId)
        return { items, activeId: keep ? o.activeId : (items[0]?.id ?? null) }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [content, currentFile, setOutline])

  // Jump to a chapter clicked in the OutlinePanel.
  useEffect(() => {
    const onJump = (e: Event) => {
      const d = (e as CustomEvent).detail as OutlineItem
      const ed = editorRef.current
      if (d?.line && ed) {
        // Put the clicked chapter at the TOP of the viewport (not centered) so
        // the outline highlight tracks the chapter you jumped to, not the one above.
        ed.setPosition({ lineNumber: d.line, column: 1 })
        ed.setScrollTop(ed.getTopForLineNumber(d.line))
        ed.focus()
      }
    }
    window.addEventListener('outline:jump', onJump)
    return () => window.removeEventListener('outline:jump', onJump)
  }, [])
  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  useEffect(() => { editorStateRef.current = editorState }, [editorState])

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [editorState.activeFileIndex])
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

  // Listen for WordViewer save status changes
  useEffect(() => {
    const handler = (e: any) => {
      setWordSaveStatus(e.detail.status)
    }
    window.addEventListener('word-viewer:save-status', handler)
    return () => window.removeEventListener('word-viewer:save-status', handler)
  }, [])

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

    // Notify viewers in THIS renderer directly (the workspace fs.watch is
    // unreliable on Windows, so LaTeX auto-compile-on-save can't rely on it).
    try { window.dispatchEvent(new CustomEvent('file:saved', { detail: { path: fullPath } })) } catch { /* ignore */ }

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
      // Terminal toggle: Cmd/Ctrl + `
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        setTerminalVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFile])

  // Load terminal panel preferences
  useEffect(() => {
    window.electronAPI.getSetting('terminalPanelPosition').then((raw) => {
      if (raw === 'top' || raw === 'bottom') setTerminalPosition(raw)
    })
    window.electronAPI.getSetting('terminalPanelVisible').then((raw) => {
      if (raw === 'true') setTerminalVisible(true)
    })
  }, [])

  // Persist terminal panel preferences
  useEffect(() => {
    window.electronAPI.setSetting('terminalPanelPosition', terminalPosition)
  }, [terminalPosition])
  useEffect(() => {
    window.electronAPI.setSetting('terminalPanelVisible', String(terminalVisible))
  }, [terminalVisible])

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
      const pathToClose = s.openFiles[idx]
      const newFiles = s.openFiles.filter((_, i) => i !== idx)
      const newIndex = Math.min(s.activeFileIndex, newFiles.length - 1)
      const newFileStates = { ...s.fileStates }
      if (pathToClose) delete newFileStates[pathToClose]
      return { ...s, openFiles: newFiles, activeFileIndex: Math.max(0, newIndex), fileStates: newFileStates }
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

  // Unified app context menu for Monaco (its native menu is disabled). Attached
  // via React onContextMenuCapture on the editor wrapper so it ALWAYS fires
  // (capture phase, independent of Monaco's internal handlers / mount timing).
  // Clipboard is done directly (navigator.clipboard + executeEdits), NOT Monaco's
  // clipboard actions, which silently no-op when the menu click moves focus.
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    const editor = editorRef.current
    if (!editor) return
    e.preventDefault()
    const sel = editor.getSelection()
    const model = editor.getModel()
    const hasSel = !!(sel && !sel.isEmpty())
    const selText = hasSel && model ? model.getValueInRange(sel) : ''

    const copy = async () => {
      if (!selText) return
      try { await navigator.clipboard.writeText(selText) }
      catch { editor.focus(); editor.getAction('editor.action.clipboardCopyAction')?.run() }
    }
    const cut = async () => {
      if (!hasSel || !sel) return
      try { await navigator.clipboard.writeText(selText) }
      catch { editor.focus(); editor.getAction('editor.action.clipboardCutAction')?.run(); return }
      editor.focus()
      editor.executeEdits('cut', [{ range: sel, text: '', forceMoveMarkers: true }])
    }
    const paste = async () => {
      let text = ''
      try { text = await navigator.clipboard.readText() }
      catch { editor.focus(); editor.getAction('editor.action.clipboardPasteAction')?.run(); return }
      if (!text) return
      editor.focus()
      const r = editor.getSelection() || sel
      if (r) editor.executeEdits('paste', [{ range: r, text, forceMoveMarkers: true }])
    }
    const selectAll = () => { editor.focus(); if (model) editor.setSelection(model.getFullModelRange()) }

    monacoCtx.open(e, [
      { icon: CopyIcon, label: '复制', shortcut: 'Ctrl+C', disabled: !hasSel, onClick: copy },
      { label: '剪切', shortcut: 'Ctrl+X', disabled: !hasSel, onClick: cut },
      { label: '粘贴', shortcut: 'Ctrl+V', onClick: paste },
      { separator: true },
      ...(hasSel ? [{
        icon: QuoteIcon, label: '引用到对话', onClick: () => {
          const fp = model?.uri?.fsPath || ''
          const fileName = fp.replace(/\\/g, '/').split('/').pop() || fp
          window.dispatchEvent(new CustomEvent('editor:text-selected', {
            detail: {
              type: getFileInfo(currentFileRef.current || '').kind === 'markdown' ? 'markdown' : getFileInfo(currentFileRef.current || '').kind === 'latex' ? 'latex' : 'code',
              filePath: fp, fileName, selectedText: selText,
              range: { startLine: sel!.startLineNumber, startColumn: sel!.startColumn, endLine: sel!.endLineNumber, endColumn: sel!.endColumn },
            },
          }))
        },
      }] : []),
      { separator: true },
      { label: '全选', shortcut: 'Ctrl+A', onClick: selectAll },
      { label: '命令面板', shortcut: 'F1', onClick: () => { editor.focus(); editor.getAction('editor.action.quickCommand')?.run() } },
    ])
  }, [monacoCtx])

  const handleEditorMount = (editor: any, monacoInstance: any) => {
    monacoRef.current = monacoInstance
    editorRef.current = editor
    registerTexLanguages(monacoInstance)

    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column })
      const fp = currentFileRef.current
      if (!fp) return
      setEditorState((s) => ({
        ...s,
        fileStates: {
          ...s.fileStates,
          [fp]: {
            ...(s.fileStates[fp] || {}),
            cursorLine: e.position.lineNumber,
            cursorColumn: e.position.column,
          },
        },
      }))
    })
    editor.onDidScrollChange((e: any) => {
      const fp = currentFileRef.current
      if (!fp) return
      setEditorState((s) => ({
        ...s,
        fileStates: {
          ...s.fileStates,
          [fp]: {
            ...(s.fileStates[fp] || {}),
            scrollTop: e.scrollTop,
          },
        },
      }))
      // Highlight the chapter at the top of the viewport in the outline.
      const items = outlineItemsRef.current
      if (items.length > 0) {
        const top = editor.getVisibleRanges()[0]?.startLineNumber ?? 1
        let activeId = items[0].id
        for (const it of items) { if ((it.line ?? 0) <= top) activeId = it.id; else break }
        setOutline((o) => (o.activeId === activeId ? o : { ...o, activeId }))
      }
    })
    // Restore scroll + cursor when model changes (tab switch).
    // Delay with rAF + setTimeout so Monaco React's setValue() (which resets
    // scroll to top) has already run before we restore the saved position.
    editor.onDidChangeModel(() => {
      const model = editor.getModel()
      if (!model) return
      const fsPath = model.uri.fsPath
      const ws = workspaceRef.current
      let state = editorStateRef.current.fileStates[fsPath]
      if (!state && ws?.path) {
        for (const [key, val] of Object.entries(editorStateRef.current.fileStates)) {
          const keyFull = window.electronAPI.pathIsAbsolute(key)
            ? key
            : window.electronAPI.pathJoin(ws.path, key)
          if (keyFull === fsPath) {
            state = val
            break
          }
        }
      }
      if (state) {
        // Apply the saved scroll/cursor across a few frames so it lands the
        // instant the content finishes loading — minimizing the top-then-jump
        // flash (a single delayed apply showed the top first).
        let tries = 0
        const restore = () => {
          if (editor.getModel() !== model) return // switched again
          if (state!.scrollTop != null) editor.setScrollTop(state!.scrollTop)
          if (state!.cursorLine != null) editor.setPosition({ lineNumber: state!.cursorLine, column: state!.cursorColumn || 1 })
          if (tries++ < 4) requestAnimationFrame(restore)
        }
        requestAnimationFrame(restore)
      }
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

    // ── Python LSP Integration ──
    if (workspaceRef.current?.path) {
      setupPythonLSP(monacoInstance, workspaceRef.current.path)
    }

    // Configure language service diagnostics
    if (monacoInstance.languages.typescript) {
      monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
        module: monacoInstance.languages.typescript.ModuleKind.ESNext,
        allowNonTsExtensions: true,
        noEmit: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      })
      monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        noEmit: true,
        strict: true,
      })
    }
    if (monacoInstance.languages.json) {
      monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemas: [],
      })
    }

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

  // ── Python LSP Setup ──
  async function setupPythonLSP(monacoInstance: any, workspacePath: string) {
    const lsp = pythonLspRef.current
    if (lsp?.completionDisposable) return // Already registered

    const completionDisposable = monacoInstance.languages.registerCompletionItemProvider('python', {
      triggerCharacters: ['.', ':', '('],
      provideCompletionItems: async (model: any, position: any) => {
        const currentLsp = pythonLspRef.current
        if (!currentLsp?.lspReady || currentLsp.workspacePath !== workspacePath) return { suggestions: [] }

        try {
          const uri = model.uri.toString()
          const items = await window.electronAPI.pythonLspCompletion(workspacePath, uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })

          const kindMap: Record<number, any> = {
            1: monacoInstance.languages.CompletionItemKind.Text,
            2: monacoInstance.languages.CompletionItemKind.Method,
            3: monacoInstance.languages.CompletionItemKind.Function,
            4: monacoInstance.languages.CompletionItemKind.Constructor,
            5: monacoInstance.languages.CompletionItemKind.Field,
            6: monacoInstance.languages.CompletionItemKind.Variable,
            7: monacoInstance.languages.CompletionItemKind.Class,
            8: monacoInstance.languages.CompletionItemKind.Interface,
            9: monacoInstance.languages.CompletionItemKind.Module,
            10: monacoInstance.languages.CompletionItemKind.Property,
            11: monacoInstance.languages.CompletionItemKind.Unit,
            12: monacoInstance.languages.CompletionItemKind.Value,
            13: monacoInstance.languages.CompletionItemKind.Enum,
            14: monacoInstance.languages.CompletionItemKind.Keyword,
            15: monacoInstance.languages.CompletionItemKind.Snippet,
            16: monacoInstance.languages.CompletionItemKind.Color,
            17: monacoInstance.languages.CompletionItemKind.File,
            18: monacoInstance.languages.CompletionItemKind.Reference,
            19: monacoInstance.languages.CompletionItemKind.Folder,
            20: monacoInstance.languages.CompletionItemKind.EnumMember,
            21: monacoInstance.languages.CompletionItemKind.Constant,
            22: monacoInstance.languages.CompletionItemKind.Struct,
            23: monacoInstance.languages.CompletionItemKind.Event,
            24: monacoInstance.languages.CompletionItemKind.Operator,
            25: monacoInstance.languages.CompletionItemKind.TypeParameter,
          }

          return {
            suggestions: items.map((item: any) => ({
              label: item.label,
              kind: kindMap[item.kind] || monacoInstance.languages.CompletionItemKind.Text,
              insertText: item.insertText || item.label,
              detail: item.detail,
              documentation: item.documentation?.value || item.documentation,
              sortText: item.sortText,
              filterText: item.filterText,
              preselect: item.preselect,
            })),
          }
        } catch {
          return { suggestions: [] }
        }
      },
    })

    const hoverDisposable = monacoInstance.languages.registerHoverProvider('python', {
      provideHover: async (model: any, position: any) => {
        const currentLsp = pythonLspRef.current
        if (!currentLsp?.lspReady || currentLsp.workspacePath !== workspacePath) return null

        try {
          const uri = model.uri.toString()
          const hover = await window.electronAPI.pythonLspHover(workspacePath, uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })
          if (!hover) return null
          return {
            contents: [{ value: hover.contents }],
          }
        } catch {
          return null
        }
      },
    })

    // Listen for diagnostics from main process
    const diagnosticsUnsub = window.electronAPI.onPythonLspDiagnostics((lspWorkspacePath, event) => {
      if (lspWorkspacePath !== workspacePath) return
      const model = monacoInstance.editor.getModels().find((m: any) => m.uri.toString() === event.uri)
      if (model) {
        monacoInstance.editor.setModelMarkers(model, 'python', event.diagnostics.map((d: any) => ({
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          message: d.message,
          severity: d.severity === 1 ? monacoInstance.editor.MarkerSeverity.Error
            : d.severity === 2 ? monacoInstance.editor.MarkerSeverity.Warning
            : d.severity === 3 ? monacoInstance.editor.MarkerSeverity.Info
            : monacoInstance.editor.MarkerSeverity.Hint,
          source: d.source,
          code: d.code,
        })))
      }
    })

    pythonLspRef.current = {
      workspacePath: null,
      lspReady: false,
      completionDisposable,
      hoverDisposable,
      diagnosticsUnsub,
    }
  }

  // Detect Python environment for status bar
  useEffect(() => {
    if (!workspace?.path) {
      setPythonEnvInfo(null)
      setAvailablePythonEnvs([])
      setSelectedPythonEnvId(null)
      return
    }

    async function loadEnvs() {
      if (!workspace?.path) return
      // Load saved selection
      const savedKey = `pythonEnv:${workspace.path}`
      const savedId = await window.electronAPI.getSetting(savedKey)

      // Load available envs and current selection
      const envs = await window.electronAPI.pythonEnvListAvailable(workspace.path)
      setAvailablePythonEnvs(envs)

      const selected = await window.electronAPI.pythonEnvGetSelected(workspace.path, savedId || null)
      if (selected) {
        setSelectedPythonEnvId(selected.id)
        setPythonEnvInfo({ type: selected.type, pythonPath: selected.pythonPath })
      } else {
        setSelectedPythonEnvId(null)
        setPythonEnvInfo(null)
      }
    }

    loadEnvs()
  }, [workspace?.path])

  // Persist Python env selection
  const handleSelectPythonEnv = async (envId: string) => {
    if (!workspace?.path) return
    setSelectedPythonEnvId(envId)
    const selected = availablePythonEnvs.find(e => e.id === envId)
    if (selected) {
      setPythonEnvInfo({ type: selected.type, pythonPath: selected.pythonPath })
    }
    await window.electronAPI.setSetting(`pythonEnv:${workspace.path}`, envId)
  }

  // Open Python document in LSP when file changes
  useEffect(() => {
    if (!currentFile || !workspace?.path) return
    const fi = getFileInfo(currentFile)
    if (fi.lang !== 'python') return

    const fullPath = window.electronAPI.pathIsAbsolute(currentFile)
      ? currentFile
      : window.electronAPI.pathJoin(workspace.path, currentFile)
    const uri = `file://${fullPath}`

    async function openDoc() {
      const lsp = pythonLspRef.current
      if (!lsp) return

      // Start LSP for this workspace if needed
      if (lsp.workspacePath !== workspace!.path || !lsp.lspReady) {
        lsp.lspReady = false
        lsp.workspacePath = workspace!.path
        const started = await window.electronAPI.pythonLspStart(workspace!.path)
        if (!started) {
          console.warn('[Editor] Failed to start Python LSP for workspace:', workspace!.path)
          return
        }
        lsp.lspReady = true
      }

      // Open document with current editor content
      const currentContent = editorRef.current?.getValue() || content
      await window.electronAPI.pythonLspOpen(workspace!.path, uri, currentContent).catch(() => {})
    }

    openDoc()
  }, [currentFile, workspace?.path])

  // Cleanup Python LSP when workspace changes or component unmounts
  useEffect(() => {
    const currentWorkspace = workspace?.path
    return () => {
      const lsp = pythonLspRef.current
      if (lsp && lsp.workspacePath && lsp.workspacePath !== currentWorkspace) {
        window.electronAPI.pythonLspStop(lsp.workspacePath).catch(() => {})
        lsp.lspReady = false
        lsp.workspacePath = null
      }
    }
  }, [workspace?.path])

  // Markdown 双窗格滚动同步
  useEditorPreviewScrollSync(editorRef.current, previewRef, view === 'split' && syncScrollEnabled && isMarkdown)

  // Persist Markdown preview scroll position per file
  useEffect(() => {
    const preview = previewRef.current
    if (!preview || !currentFile) return
    const handler = () => {
      setEditorState((s) => ({
        ...s,
        fileStates: {
          ...s.fileStates,
          [currentFile]: {
            ...(s.fileStates[currentFile] || {}),
            previewScrollTop: preview.scrollTop,
          },
        },
      }))
    }
    preview.addEventListener('scroll', handler)
    return () => preview.removeEventListener('scroll', handler)
  }, [currentFile])

  // Restore Markdown preview scroll when switching tabs / views
  useEffect(() => {
    const preview = previewRef.current
    if (!preview || !currentFile || !isMarkdown) return
    const state = editorState.fileStates[currentFile]
    if (state?.previewScrollTop != null) {
      const raf = requestAnimationFrame(() => {
        const timer = setTimeout(() => {
          preview.scrollTop = state.previewScrollTop!
        }, 100)
        return () => clearTimeout(timer)
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [currentFile, view, isMarkdown])

  const handleEditorChange = (value: string | undefined) => {
    if (isProgrammaticChange.current) return
    setContent(value || '')
    setIsDirty(true)

    // Notify Python LSP of document changes
    const ws = workspaceRef.current
    const lsp = pythonLspRef.current
    if (ws?.path && lsp?.lspReady && currentFileRef.current) {
      const fileInfo = getFileInfo(currentFileRef.current)
      if (fileInfo.lang === 'python') {
        const fullPath = window.electronAPI.pathIsAbsolute(currentFileRef.current)
          ? currentFileRef.current
          : window.electronAPI.pathJoin(ws.path, currentFileRef.current)
        const uri = monacoRef.current?.Uri.file(fullPath).toString() || `file://${fullPath}`
        window.electronAPI.pythonLspChange(ws.path, uri, value || '').catch(() => {})
      }
    }
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

      // 同步滚动开关（仅在 split 模式显示）
      if (view === 'split') {
        tools.push(
          <button
            key="sync-scroll"
            onClick={() => {
              setSyncScrollEnabled((prev) => {
                const next = !prev
                setEditorState((s) => ({ ...s, syncScrollEnabled: next }))
                if (next && editorRef.current && previewRef.current) {
                  // 打开时：右侧立即同步到左侧当前位置
                  const ed = editorRef.current
                  const preview = previewRef.current
                  const maxEditor = Math.max(1, ed.getScrollHeight() - ed.getLayoutInfo().height)
                  const ratio = ed.getScrollTop() / maxEditor
                  const maxPreview = Math.max(1, preview.scrollHeight - preview.clientHeight)
                  preview.scrollTop = ratio * maxPreview
                }
                return next
              })
            }}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
            style={{
              color: syncScrollEnabled ? 'var(--na-accent)' : 'var(--na-text-tertiary)',
              borderRadius: 'var(--na-radius-sm)',
              background: syncScrollEnabled ? 'var(--na-accent-soft)' : 'transparent',
            }}
            title={syncScrollEnabled ? '关闭同步滚动' : '开启同步滚动'}
          >
            <Link className="w-3 h-3" />
            同步
          </button>
        )
      }
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
      const isPy = fileInfo.ext === 'py'
      tools.push(
        <button
          key="run"
          onClick={() => {
            setTerminalVisible(true)
            const filePath = currentFileRef.current
            if (!filePath) return
            let cmd = ''
            if (isPy) {
              const python = pythonEnvInfo?.pythonPath || 'python'
              cmd = `"${python}" "${filePath}"`
            } else if (['js', 'ts'].includes(fileInfo.ext)) {
              cmd = fileInfo.ext === 'ts' ? `npx ts-node "${filePath}"` : `node "${filePath}"`
            } else if (fileInfo.ext === 'rs') {
              cmd = `cargo run`
            } else if (fileInfo.ext === 'go') {
              cmd = `go run "${filePath}"`
            }
            if (cmd) {
              setTimeout(() => {
                terminalPanelRef.current?.runCommand(cmd)
              }, 300)
            }
          }}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
          style={{ color: 'var(--na-status-ask)', borderRadius: 'var(--na-radius-sm)', background: 'rgba(5,150,105,0.08)' }}
          title="运行"
        >
          <Play className="w-3 h-3" />
          运行
        </button>
      )
      if (isPy) {
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
          ref={splitContainerRef}
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
            onContextMenuCapture={handleEditorContextMenu}
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
                contextmenu: false, // replaced by the app's unified context menu (below)
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
                // JetBrains-like behavior: Enter does NOT accept autocomplete suggestions
                acceptSuggestionOnEnter: 'off',
                // Enhanced IDE features
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                stickyScroll: { enabled: true },
                formatOnPaste: true,
                formatOnType: true,
                quickSuggestions: true,
                suggestOnTriggerCharacters: true,
                wordBasedSuggestions: 'allDocuments',
                parameterHints: { enabled: true },
                inlayHints: { enabled: 'on' },
                suggest: {
                  showKeywords: true,
                  showSnippets: true,
                  showFunctions: true,
                  showVariables: true,
                },
              }}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
            />
            {monacoCtx.menu}
          </div>

          {/* Draggable divider (split only) */}
          {showPreview && view === 'split' && (
            <div
              onMouseDown={(e) => {
                e.preventDefault()
                const container = splitContainerRef.current
                if (!container) return
                const onMove = (ev: MouseEvent) => {
                  const rect = container.getBoundingClientRect()
                  const pct = ((rect.right - ev.clientX) / rect.width) * 100
                  setPreviewWidth(Math.min(80, Math.max(20, pct)))
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  document.body.style.cursor = ''
                }
                document.body.style.cursor = 'col-resize'
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
              className="shrink-0 cursor-col-resize hover:bg-[var(--na-primary-soft)] transition-colors"
              style={{ width: 5, background: 'var(--na-border-subtle)' }}
              title="拖动调整宽度"
            />
          )}

          {/* Preview panel (markdown / latex) */}
          {showPreview && (
            <div
              ref={previewRef}
              className="overflow-auto"
              style={{
                flex: view === 'split' ? `0 0 ${previewWidth}%` : 1,
                width: view === 'split' ? undefined : undefined,
                borderLeft: view === 'split' ? 'none' : 'none',
                background: 'var(--na-bg-panel)',
              }}
            >
              {isMarkdown && (
                <div
                  className="p-6"
                  onContextMenu={(e) => {
                    const sel = window.getSelection()?.toString().trim() || ''
                    if (!sel) return
                    const fileName = fullPath.replace(/\\/g, '/').split('/').pop() || fullPath
                    previewCtx.open(e, [
                      { icon: QuoteIcon, label: '引用到对话', onClick: () => {
                        window.dispatchEvent(new CustomEvent('editor:text-selected', { detail: { type: 'markdown', filePath: fullPath, fileName, selectedText: sel, range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } } }))
                        window.getSelection()?.removeAllRanges()
                      } },
                      { icon: CopyIcon, label: '复制', onClick: () => navigator.clipboard.writeText(sel).catch(() => {}) },
                    ])
                  }}
                >
                  <MarkdownPreview content={content} />
                  {previewCtx.menu}
                </div>
              )}
              {isLatex && (
                <LaTeXViewer
                  filePath={fullPath}
                  editor={editorRef.current}
                  sourceFile={fullPath}
                  syncEnabled={view === 'split' && syncScrollEnabled}
                />
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
        <div className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-hide scroll-smooth">
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
                  ref={isActive ? activeTabRef : undefined}
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
      <div className="flex-1 overflow-hidden flex flex-col">
        {terminalVisible && terminalPosition === 'top' && (
          <TerminalPanel
            ref={terminalPanelRef}
            visible={terminalVisible}
            onClose={() => setTerminalVisible(false)}
            position={terminalPosition}
            onTogglePosition={() => setTerminalPosition((p) => (p === 'bottom' ? 'top' : 'bottom'))}
            workspacePath={workspace?.path}
          />
        )}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
        {terminalVisible && terminalPosition === 'bottom' && (
          <TerminalPanel
            ref={terminalPanelRef}
            visible={terminalVisible}
            onClose={() => setTerminalVisible(false)}
            position={terminalPosition}
            onTogglePosition={() => setTerminalPosition((p) => (p === 'bottom' ? 'top' : 'bottom'))}
            workspacePath={workspace?.path}
          />
        )}
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
          {fileInfo.ext === 'py' && availablePythonEnvs.length > 0 && (
            <div className="relative">
              <button
                ref={pythonEnvBtnRef}
                onClick={() => setShowPythonDropdown(!showPythonDropdown)}
                className="flex items-center gap-1 text-[11px] rounded px-2 py-0.5 border-none outline-none cursor-pointer transition-colors hover:brightness-110"
                style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-secondary)', fontFamily: 'var(--na-font-mono)' }}
                title={availablePythonEnvs.find(e => e.id === selectedPythonEnvId)?.pythonPath || ''}
              >
                <span className="truncate max-w-[120px]">{availablePythonEnvs.find(e => e.id === selectedPythonEnvId)?.label || 'Python'}</span>
                <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
              </button>
              {showPythonDropdown && pythonEnvBtnRef.current &&
                createPortal(
                  <div
                    ref={pythonDropdownRef}
                    className="fixed z-[60] overflow-y-auto py-1"
                    style={{
                      left: pythonEnvBtnRef.current.getBoundingClientRect().left,
                      bottom: window.innerHeight - pythonEnvBtnRef.current.getBoundingClientRect().top + 4,
                      minWidth: Math.max(pythonEnvBtnRef.current.getBoundingClientRect().width, 200),
                      maxHeight: 260,
                      borderRadius: 'var(--na-radius-lg)',
                      background: 'var(--na-bg-popover)',
                      boxShadow: 'var(--na-shadow-lg)',
                      border: '1px solid var(--na-border-subtle)',
                    }}
                  >
                    {availablePythonEnvs.map((env) => (
                      <button
                        key={env.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectPythonEnv(env.id)
                          setShowPythonDropdown(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2 hover:bg-[var(--na-bg-hover)]"
                        style={{
                          background: env.id === selectedPythonEnvId ? 'var(--na-bg-active)' : 'transparent',
                          color: 'var(--na-text-primary)',
                        }}
                      >
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium"
                          style={{
                            background: env.type === 'conda' ? 'rgba(59,130,246,0.12)' : env.type === 'uv-agent' ? 'rgba(124,58,237,0.12)' : 'rgba(16,185,129,0.12)',
                            color: env.type === 'conda' ? '#3b82f6' : env.type === 'uv-agent' ? '#7c3aed' : '#10b981',
                          }}
                        >
                          {env.type === 'conda' ? 'conda' : env.type === 'uv-agent' ? 'agent' : env.type === 'system' ? 'sys' : 'venv'}
                        </span>
                        <span className="truncate flex-1">{env.label}</span>
                        {env.id === selectedPythonEnvId && (
                          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-status-ask)' }} />
                        )}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
            </div>
          )}
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
          {wordSaveStatus === 'saving' && <span style={{ color: 'var(--na-status-execute)' }}>保存中...</span>}
          {wordSaveStatus === 'saved' && <span>· 已自动保存</span>}
          {wordSaveStatus === 'error' && <span style={{ color: 'var(--na-status-explore)' }}>保存失败</span>}

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
            onClick={() => setTerminalVisible((v) => !v)}
            className="p-0.5 rounded transition-colors hover:opacity-70"
            style={{ color: terminalVisible ? 'var(--na-accent)' : 'var(--na-text-tertiary)' }}
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
