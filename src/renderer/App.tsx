import { useEffect, useState, useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  tasksAtom,
  taskFoldersAtom,
  workspacesAtom,
  currentTaskIdAtom,
  currentWorkspaceIdAtom,
  currentSessionAtom,
  messagesAtom,
  editorStateAtom,
  themeAtom,
  langAtom,
} from './atoms'
import { Toaster, toast } from 'sonner'
import { Panel, Group, Separator, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import Sidebar from './components/Sidebar'
import MarkdownEditor from './components/Editor'
import ChatPanel from './components/ChatPanel'
import SettingsModal from './components/SettingsModal'
import FloatingPanel from './components/FloatingPanel'
import ShellEnvSetupModal from './components/ShellEnvSetupModal'

export default function App() {
  const [tasks, setTasks] = useAtom(tasksAtom)
  const [taskFolders, setTaskFolders] = useAtom(taskFoldersAtom)
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [currentTaskId, setCurrentTaskId] = useAtom(currentTaskIdAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentWorkspaceIdAtom)
  const [session, setSession] = useAtom(currentSessionAtom)
  const [messages, setMessages] = useAtom(messagesAtom)
  const [editorState, setEditorState] = useAtom(editorStateAtom)
  const [theme, setTheme] = useAtom(themeAtom)
  const [lang, setLang] = useAtom(langAtom)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [showShellEnvSetup, setShowShellEnvSetup] = useState(false)
  const [platform, setPlatform] = useState('linux')
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const sidebarRef = useRef<PanelImperativeHandle>(null)
  const chatRef = useRef<PanelImperativeHandle>(null)
  const sidebarWrapperRef = useRef<HTMLDivElement>(null)

  // Theme + appearance config
  useEffect(() => {
    async function loadAppearance() {
      const saved = await window.electronAPI.getSetting('appearanceConfig')
      if (saved) {
        try {
          const config = JSON.parse(saved)
          if (config.theme) {
            const resolved = config.theme === 'system'
              ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
              : config.theme
            setTheme(resolved)
          }
          if (config.lang && ['zh', 'en', 'ja'].includes(config.lang)) {
            setLang(config.lang)
          }
          // Apply UI font
          if (config.uiFont) {
            const uiFontMap: Record<string, string> = {
              system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              inter: '"Inter", -apple-system, sans-serif',
              'sf-pro': '"SF Pro Display", -apple-system, sans-serif',
            }
            document.documentElement.style.setProperty('--na-font-ui', uiFontMap[config.uiFont] || uiFontMap.system)
          }
          // Apply scale via Electron zoom factor
          const scale = config.scale ?? 1
          window.electronAPI.setZoomFactor(scale)
        } catch {}
      }
    }
    loadAppearance()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.setProperty('color-scheme', theme)
    document.documentElement.lang = lang
  }, [theme, lang])

  // Detect platform and shell env setup status
  useEffect(() => {
    ;(async () => {
      const plat = await window.electronAPI.getPlatform()
      setPlatform(plat)
      if (plat === 'win32') {
        const hasSetup = await window.electronAPI.shellEnvHasSetup()
        if (!hasSetup) {
          setShowShellEnvSetup(true)
        }
      }
    })()
  }, [])

  // Cmd/Ctrl+, for settings
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Global Escape: emergency reset for any stuck overlays / dropdowns
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close settings modal
        setSettingsOpen(false)
        // Broadcast to child components so they can close their own overlays
        window.dispatchEvent(new CustomEvent('app:escape-pressed'))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Listen for open-settings event from ChatPanel
  useEffect(() => {
    const handler = (e: any) => {
      setSettingsOpen(true)
    }
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  // Load data
  useEffect(() => {
    async function loadData() {
      try {
        const [wsData, tasksData, foldersData, settings] = await Promise.all([
          window.electronAPI.getWorkspaces(),
          window.electronAPI.getTasks(),
          Promise.resolve().then(async () => {
            const ws = await window.electronAPI.getWorkspaces()
            const allFolders: any[] = []
            for (const w of ws) {
              const folders = await window.electronAPI.getTaskFolders(w.id)
              allFolders.push(...folders)
            }
            return allFolders
          }),
          window.electronAPI.getSetting('appSettings'),
        ])
        setWorkspaces(wsData)
        setTasks(tasksData)
        setTaskFolders(foldersData)

        if (settings) {
          try {
            const parsed = JSON.parse(settings)
            if (parsed.theme && parsed.theme !== theme) setTheme(parsed.theme)
            if (parsed.lastTaskId) setCurrentTaskId(parsed.lastTaskId)
            if (parsed.lastWorkspaceId) setCurrentWorkspaceId(parsed.lastWorkspaceId)
          } catch {}
        }
      } catch (e: any) {
        toast.error('加载数据失败: ' + e.message)
      }
    }
    loadData()
  }, [])

  // Save app settings
  const saveAppSettings = useCallback(async () => {
    await window.electronAPI.setSetting('appSettings', JSON.stringify({
      theme,
      lastTaskId: currentTaskId,
      lastWorkspaceId: currentWorkspaceId,
    }))
  }, [theme, currentTaskId, currentWorkspaceId])

  useEffect(() => {
    saveAppSettings()
  }, [saveAppSettings])

  // Load session + messages when task changes
  useEffect(() => {
    async function loadSession() {
      if (!currentTaskId) {
        setSession(null)
        setMessages([])
        return
      }
      try {
        const s = await window.electronAPI.getSessionByTask(currentTaskId)
        if (s) {
          setSession(s)
          const msgs = await window.electronAPI.getMessages(s.id)
          setMessages(msgs)
        } else {
          const task = tasks.find((t) => t.id === currentTaskId)
          if (task) {
            // Creation tasks (new Skill/MCP/API) default to execute mode
            const defaultMode = task.title.startsWith('新建 ') ? 'execute' : 'explore'
            const newSession = await window.electronAPI.createSession(
              currentTaskId,
              task.title,
              defaultMode
            )
            setSession(newSession)
            // Auto-add assistant prompt for creation tasks
            if (task.title.startsWith('新建 ')) {
              const typeLabel = task.title.replace('新建 ', '')
              const promptText = `请描述你想要创建的 ${typeLabel}，包括：\n\n- 用途/场景\n- 触发条件（如果有）\n- 任何参考链接或文档\n\n你可以提供 GitHub 链接、README 或其他参考资料，我会自动获取内容并为你生成配置。`
              const assistantMsg = await window.electronAPI.createMessage(newSession.id, 'assistant', promptText)
              setMessages([assistantMsg])
            } else {
              setMessages([])
            }
          }
        }

        const task = tasks.find((t) => t.id === currentTaskId)
        if (task?.workspace_id) {
          setCurrentWorkspaceId(task.workspace_id)
        }
        if (task?.editor_state) {
          try {
            const state = JSON.parse(task.editor_state)
            setEditorState((s) => ({ ...s, ...state }))
          } catch {}
        }
      } catch (e: any) {
        toast.error('加载会话失败: ' + e.message)
      }
    }
    loadSession()
  }, [currentTaskId])

  // Auto save editor state
  useEffect(() => {
    if (!currentTaskId) return
    const timer = setTimeout(async () => {
      try {
        await window.electronAPI.updateTask(currentTaskId, undefined, JSON.stringify(editorState))
      } catch {}
    }, 500)
    return () => clearTimeout(timer)
  }, [editorState, currentTaskId])

  const handleSidebarResize = (size: PanelSize) => {
    setSidebarCollapsed(size.asPercentage < 0.5)
    setSidebarWidth(Math.round(size.inPixels))
  }

  useEffect(() => {
    if (!sidebarWrapperRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarWidth(Math.round(entry.contentRect.width))
      }
    })
    observer.observe(sidebarWrapperRef.current)
    return () => observer.disconnect()
  }, [])
  const handleChatResize = (size: PanelSize) => {
    setChatCollapsed(size.asPercentage < 0.5)
  }

  return (
    <div
      className="h-screen w-screen flex flex-row overflow-hidden"
      style={{ background: 'var(--na-bg-app)' }}
    >
      <Toaster
        position="bottom-right"
        duration={5000}
        closeButton
        toastOptions={{
          style: {
            background: 'var(--na-bg-popover)',
            color: 'var(--na-text-primary)',
            border: '1px solid var(--na-border-subtle)',
            fontSize: '13px',
          },
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onSettingsChange={() => {
          window.dispatchEvent(new CustomEvent('settings:changed'))
          // Reload theme
          window.electronAPI.getSetting('appearanceConfig').then((saved: any) => {
            if (saved) {
              try {
                const config = JSON.parse(saved)
                if (config.theme) {
                  const resolved = config.theme === 'system'
                    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                    : config.theme
                  setTheme(resolved)
                }
                if (config.uiFont) {
                  const uiFontMap: Record<string, string> = {
                    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    inter: '"Inter", -apple-system, sans-serif',
                    'sf-pro': '"SF Pro Display", -apple-system, sans-serif',
                  }
                  document.documentElement.style.setProperty('--na-font-ui', uiFontMap[config.uiFont] || uiFontMap.system)
                }
                // Apply scale immediately
                window.electronAPI.setZoomFactor(config.scale ?? 1)
                // Reload language
                if (config.lang && ['zh', 'en', 'ja'].includes(config.lang)) {
                  setLang(config.lang)
                }
              } catch {}
            }
          })
        }}
      />

      <FloatingPanel />

      {/* Sidebar Collapse Bar */}
      {sidebarCollapsed && (
        <button
          onClick={() => sidebarRef.current?.expand()}
          className="shrink-0 flex items-center justify-center transition-colors"
          style={{
            width: 32,
            borderRight: '1px solid var(--na-border-subtle)',
            background: 'var(--na-bg-sidebar)',
            color: 'var(--na-text-tertiary)',
          }}
          title="展开侧边栏"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
        </button>
      )}

      <Group orientation="horizontal" className="flex-1">
        {/* Sidebar */}
        <Panel
          panelRef={sidebarRef}
          defaultSize="18%"
          minSize="12%"
          maxSize="30%"
          collapsible
          collapsedSize="0%"
          onResize={handleSidebarResize}
        >
          <div ref={sidebarWrapperRef} className="h-full w-full">
            <Sidebar
              onToggle={() => sidebarRef.current?.collapse()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        </Panel>

        <Separator
          className="group relative"
          style={{ flexBasis: '4px', background: 'var(--na-border-subtle)' }}
        />

        {/* Editor */}
        <Panel defaultSize="55%" minSize="30%" className="!overflow-visible">
          <MarkdownEditor />
        </Panel>

        <Separator
          className="group relative"
          style={{ flexBasis: '4px', background: 'var(--na-border-subtle)' }}
        />

        {/* Chat */}
        <Panel
          panelRef={chatRef}
          defaultSize="27%"
          minSize="18%"
          maxSize="45%"
          collapsible
          collapsedSize="0%"
          onResize={handleChatResize}
        >
          <ChatPanel
            isCollapsed={chatCollapsed}
            onToggle={() => chatRef.current?.collapse()}
          />
        </Panel>
      </Group>

      {/* Chat Collapse Bar */}
      {chatCollapsed && (
        <button
          onClick={() => chatRef.current?.expand()}
          className="shrink-0 flex items-center justify-center transition-colors"
          style={{
            width: 32,
            borderLeft: '1px solid var(--na-border-subtle)',
            background: 'var(--na-bg-sidebar)',
            color: 'var(--na-text-tertiary)',
          }}
          title="展开聊天面板"
        >
          <PanelRightOpen className="w-3.5 h-3.5" />
        </button>
      )}
      {showShellEnvSetup && platform === 'win32' && (
        <ShellEnvSetupModal onComplete={() => setShowShellEnvSetup(false)} />
      )}
    </div>
  )
}
