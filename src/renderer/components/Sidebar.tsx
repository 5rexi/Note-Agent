import { useState, useRef, useEffect } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useT } from '../hooks/useT'
import {
  tasksAtom,
  taskFoldersAtom,
  workspacesAtom,
  currentTaskIdAtom,
  currentWorkspaceIdAtom,
  editorStateAtom,
  themeAtom,
  streamingTaskIdsAtom,
  type Task,
  type Workspace,
} from '../atoms'
import { toast } from 'sonner'
import {
  Check,
  Plus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  Sun,
  Moon,
  Settings,
  FileCode,
  Folder,
  Circle,
  Timer,
  Cable,
  Wrench,
  Globe,
  HardDrive,
  Trash2,
  Pencil,
  Archive,
  Loader2,
  FileText,
  Copy,
  RefreshCw,
  Sparkles,
  FilePlus,
} from 'lucide-react'
import ReportGenerateModal from './ReportGenerateModal'
import ManagerModal from './ManagerModal'
import { DataSourceItem, SkillItem } from './sidebar'

interface SidebarProps {
  onToggle: () => void
  onOpenSettings: () => void
}

const STATUS_ORDER: Array<Task['status']> = ['todo', 'in_progress', 'done', 'archived', 'temp']

const statusConfig: Record<string, { color: string; icon: typeof Circle }> = {
  temp: { color: '#8B5CF6', icon: Sparkles },
  todo: { color: '#737373', icon: Circle },
  in_progress: { color: '#2563EB', icon: Timer },
  done: { color: '#059669', icon: Check },
  archived: { color: '#737373', icon: Archive },
}

export default function Sidebar({ onToggle, onOpenSettings }: SidebarProps) {
  const { t } = useT()
  const statusLabels: Record<string, string> = {
    temp: t('temp'),
    todo: t('todo'),
    in_progress: t('inProgress'),
    done: t('done'),
    archived: t('archived'),
  }
  const [tasks, setTasks] = useAtom(tasksAtom)
  const [taskFolders, setTaskFolders] = useAtom(taskFoldersAtom)
  const [workspaces, setWorkspaces] = useAtom(workspacesAtom)
  const [currentTaskId, setCurrentTaskId] = useAtom(currentTaskIdAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentWorkspaceIdAtom)
  const [editorState, setEditorState] = useAtom(editorStateAtom)
  const [theme, setTheme] = useAtom(themeAtom)
  const streamingTaskIds = useAtomValue(streamingTaskIdsAtom)
  const [isFileMode, setIsFileMode] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ todo: true, in_progress: false, done: false, archived: false })
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editFolderValue, setEditFolderValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'task' | 'folder' | 'workspace'; id: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [reportContextMenu, setReportContextMenu] = useState<{ x: number; y: number; report: { name: string; path: string } } | null>(null)
  const reportMenuRef = useRef<HTMLDivElement>(null)
  const [editingReportPath, setEditingReportPath] = useState<string | null>(null)
  const taskInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Report generation
  const [reportExpanded, setReportExpanded] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reports, setReports] = useState<{ name: string; path: string }[]>([])
  const [reportEnabled, setReportEnabled] = useState(false)
  const [reportDir, setReportDir] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerTab, setManagerTab] = useState<'skills' | 'mcp' | 'api'>('skills')

  // Knowledge base
  const [kbFolders, setKbFolders] = useState<Array<{ id: number; path: string; name: string; last_indexed_at: number | null }>>([])
  const [kbIndexing, setKbIndexing] = useState<Set<number>>(new Set())

  const loadKbFolders = async () => {
    try {
      const folders = await window.electronAPI.kbListFolders()
      setKbFolders(folders)
    } catch (e) {
      console.error('[Sidebar] Failed to load KB folders:', e)
    }
  }

  const addKbFolder = async () => {
    const result = await window.electronAPI.openDirectory()
    if (result.canceled || !result.path) return
    const name = window.electronAPI.pathBasename(result.path)
    await window.electronAPI.kbAddFolder(result.path, name)
    await loadKbFolders()
  }

  const removeKbFolder = async (id: number) => {
    await window.electronAPI.kbRemoveFolder(id)
    await loadKbFolders()
  }

  const indexKbFolder = async (id: number) => {
    setKbIndexing((prev) => new Set(prev).add(id))
    try {
      await window.electronAPI.kbIndexFolder(id)
      await loadKbFolders()
    } finally {
      setKbIndexing((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  useEffect(() => {
    loadKbFolders()
  }, [])

  // Load folders when workspace changes
  useEffect(() => {
    async function loadFolders() {
      if (!currentWorkspaceId) return
      const folders = await window.electronAPI.getTaskFolders(currentWorkspaceId)
      setTaskFolders(folders)
    }
    loadFolders()
  }, [currentWorkspaceId])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
      if (reportMenuRef.current && !reportMenuRef.current.contains(e.target as Node)) {
        setReportContextMenu(null)
      }
    }
    if (contextMenu || reportContextMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, reportContextMenu])

  useEffect(() => {
    loadGeneralConfig()
    const handler = () => loadGeneralConfig()
    window.addEventListener('settings:changed', handler)
    return () => window.removeEventListener('settings:changed', handler)
  }, [])

  // Global escape: cancel any inline editing / close context menu
  useEffect(() => {
    const handler = () => {
      setEditingTaskId(null)
      setEditingFolderId(null)
      setEditingReportPath(null)
      setContextMenu(null)
      setReportContextMenu(null)
      // Notify FileTreeView to cancel its editing states
      window.dispatchEvent(new CustomEvent('file-tree:cancel-editing'))
    }
    window.addEventListener('app:escape-pressed', handler)
    return () => window.removeEventListener('app:escape-pressed', handler)
  }, [])

  const createFolder = async () => {
    if (!currentWorkspaceId) { toast.error(t('selectWorkspaceFirst')); return }
    const newFolder = await window.electronAPI.createTaskFolder({ workspace_id: currentWorkspaceId, name: t('newFolder') })
    setTaskFolders((prev) => [newFolder, ...prev])
    setExpandedFolders((prev) => ({ ...prev, [newFolder.id]: true }))
    setEditingFolderId(newFolder.id)
  }

  const createTask = async (status?: Task['status'], folderId?: string) => {
    if (!currentWorkspaceId) { toast.error(t('selectWorkspaceFirst')); return }
    const newTask = await window.electronAPI.createTask(t('newTask'), currentWorkspaceId, folderId)
    // If status is specified and different from default, update it
    if (status && status !== 'todo') {
      await window.electronAPI.updateTask(newTask.id, undefined, undefined, status)
      setTasks((prev) => prev.map((t) => (t.id === newTask.id ? { ...t, status } : t)))
    } else {
      setTasks((prev) => [...prev, { ...newTask, status: 'todo' }])
    }
    setCurrentTaskId(newTask.id)
    setEditingTaskId(newTask.id)
    if (status) {
      setExpandedGroups((prev) => ({ ...prev, [status]: true }))
    }
    if (folderId) {
      setExpandedFolders((prev) => ({ ...prev, [folderId]: true }))
    }
  }

  const createCreationTask = async (typeLabel: string) => {
    if (!currentWorkspaceId) { toast.error(t('selectWorkspaceFirst')); return }
    const title = `${t('newTask')} ${typeLabel}`
    const newTask = await window.electronAPI.createTask(title, currentWorkspaceId)
    await window.electronAPI.updateTask(newTask.id, title, undefined, 'temp')
    setTasks((prev) => [...prev, { ...newTask, title, status: 'temp' }])
    setCurrentTaskId(newTask.id)
    setExpandedGroups((prev) => ({ ...prev, temp: true }))
    toast.success(`${t('createdTask')}: ${title}`)
  }

  const importWorkspace = async () => {
    const result = await window.electronAPI.openDirectory()
    if (!result.path || result.canceled) return
    const existing = workspaces.find((w) => w.path === result.path)
    if (existing) { setCurrentWorkspaceId(existing.id); toast.info(t('workspaceExists')); return }
    const name = window.electronAPI.pathBasename(result.path)
    try {
      const ws = await window.electronAPI.createWorkspace(name, result.path)
      setWorkspaces((prev) => [...prev, ws])
      setCurrentWorkspaceId(ws.id)
      toast.success(`${t('imported')}: ${name}`)
    } catch (e: any) { toast.error(t('importFailed') + ': ' + e.message) }
  }

  const loadGeneralConfig = async () => {
    const saved = await window.electronAPI.getSetting('generalConfig')
    if (saved) {
      try {
        const cfg = JSON.parse(saved)
        setReportEnabled(cfg.reportEnabled || false)
        setReportDir(cfg.reportDir || '')
      } catch {}
    }
  }

  const loadReports = async () => {
    const saved = await window.electronAPI.getSetting('generalConfig')
    if (!saved) { setReports([]); return }
    try {
      const cfg = JSON.parse(saved)
      if (cfg.reportEnabled && cfg.reportDir) {
        const list = await window.electronAPI.listReports(cfg.reportDir)
        setReports(list)
      } else {
        setReports([])
      }
    } catch { setReports([]) }
  }

  const cycleStatus = async (taskId: string, current: string) => {
    const order = STATUS_ORDER
    const idx = order.indexOf(current as Task['status'])
    const next = order[(idx + 1) % order.length]
    await window.electronAPI.updateTask(taskId, undefined, undefined, next)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: next } : t)))
  }

  const setTaskStatus = async (taskId: string, status: Task['status']) => {
    await window.electronAPI.updateTask(taskId, undefined, undefined, status)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)))
  }

  const renameTask = async (taskId: string) => {
    const value = taskInputRef.current?.value ?? ''
    if (!value.trim()) { setEditingTaskId(null); return }
    await window.electronAPI.updateTask(taskId, value.trim())
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, title: value.trim() } : t)))
    setEditingTaskId(null)
  }

  const renameFolder = async (folderId: string) => {
    const value = folderInputRef.current?.value ?? ''
    if (!value.trim()) { setEditingFolderId(null); return }
    await window.electronAPI.updateTaskFolder(folderId, { name: value.trim() })
    setTaskFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: value.trim() } : f)))
    setEditingFolderId(null)
  }

  const deleteTask = async (taskId: string) => {
    await window.electronAPI.deleteTask(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (currentTaskId === taskId) setCurrentTaskId(null)
    setContextMenu(null)
  }

  const deleteFolder = async (folderId: string) => {
    try {
      await window.electronAPI.deleteTaskFolder(folderId)
      setTaskFolders((prev) => prev.filter((f) => f.id !== folderId))
      setTasks((prev) => prev.map((t) => (t.folder_id === folderId ? { ...t, folder_id: null } : t)))
      setContextMenu(null)
      toast.success(t('folderDeleted'))
    } catch (e: any) { toast.error(e.message || t('deleteFailed')); setContextMenu(null) }
  }

  const deleteWorkspace = async (wsId: string) => {
    await window.electronAPI.deleteWorkspace(wsId)
    setWorkspaces((prev) => prev.filter((w) => w.id !== wsId))
    if (currentWorkspaceId === wsId) setCurrentWorkspaceId(null)
    setContextMenu(null)
    toast.success(t('workspaceDeleted'))
  }

  const selectTask = (task: Task) => { setCurrentTaskId(task.id); if (task.workspace_id) setCurrentWorkspaceId(task.workspace_id); setContextMenu(null) }

  const toggleGroup = (key: string) => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  const toggleFolder = (folderId: string) => setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }))

  // Tasks grouped by status (only tasks without folder_id)
  const tasksByStatus = (status: Task['status']) => tasks.filter((t) => t.status === status && !t.folder_id && (!currentWorkspaceId || t.workspace_id === currentWorkspaceId))
  // Tasks in custom folders
  const tasksInFolder = (folderId: string) => tasks.filter((t) => t.folder_id === folderId)

  const NavSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-1.5">
      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-tertiary)' }}>{title}</div>
      {children}
    </div>
  )

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-sidebar)' }}>
      {/* Top Bar */}
      <div className="flex items-center justify-between shrink-0 px-3" style={{ height: 48, borderBottom: '1px solid var(--na-border-subtle)' }}>
        <div className="flex items-center gap-2.5">
          <img src="./assets/icon.png" alt="" className="w-6 h-6 rounded-lg" style={{ objectFit: 'cover' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>Note Agent</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => createTask('todo')} className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }} title={t('newTask')}>
            <Plus className="w-4 h-4" />
          </button>
          <button onClick={createFolder} className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }} title={t('newFolder')}>
            <FolderPlus className="w-4 h-4" />
          </button>
          <button onClick={onToggle} className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }} title={t('collapseSidebar')}>
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-1" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
        <button
          onClick={() => setIsFileMode(false)}
          className="flex-1 text-center py-1.5 text-[12px] font-medium transition-colors rounded-lg"
          style={{ color: !isFileMode ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)', background: !isFileMode ? 'var(--na-bg-active)' : 'transparent' }}
        >{t('tasks')}</button>
        <button
          onClick={() => setIsFileMode(true)}
          className="flex-1 text-center py-1.5 text-[12px] font-medium transition-colors rounded-lg"
          style={{ color: isFileMode ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)', background: isFileMode ? 'var(--na-bg-active)' : 'transparent' }}
        >{t('files')}</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-2">
        {isFileMode ? (
          <div className="px-3 pb-2">
            <div className="mb-1.5">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-tertiary)' }}>{t('files')}</span>
                {currentWorkspaceId && (
                  <button
                    onClick={() => {
                      const el = document.getElementById('file-tree-refresh-trigger')
                      el?.click()
                    }}
                    className="p-1 rounded transition-colors hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-tertiary)' }}
                    title={t('refresh')}
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
              </div>
              {currentWorkspaceId && (
                <FileTreeView
                  workspace={workspaces.find((w) => w.id === currentWorkspaceId)!}
                  currentFile={editorState.openFiles[editorState.activeFileIndex]}
                  onSelectFile={(path) => {
                    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
                    if (!ws) return
                    const relativePath = path.replace(`${ws.path}/`, '')
                    window.dispatchEvent(new CustomEvent('file-tree:open', { detail: relativePath }))
                  }}
                />
              )}
              {!currentWorkspaceId && (
                <div className="text-[13px] px-3 py-4 text-center" style={{ color: 'var(--na-text-tertiary)' }}>{t('selectWorkspaceToViewFiles')}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-3 pb-2">
            {/* Status Groups — These are the "task folders" */}
            <NavSection title={t('tasks')}>
              {STATUS_ORDER.map((status) => {
                const cfg = statusConfig[status]
                const statusTasks = tasksByStatus(status)
                const isExpanded = expandedGroups[status] !== false
                const StatusIcon = cfg.icon
                return (
                  <div key={status} className="mb-0.5">
                    <div
                      className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors group rounded-lg"
                      style={{ background: 'transparent' }}
                      onClick={() => toggleGroup(status)}
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />}
                      <StatusIcon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} />
                      <span className="flex-1 text-[13px] font-medium" style={{ color: 'var(--na-text-primary)' }}>{statusLabels[status]}</span>
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0 order-1" onClick={(e) => { e.stopPropagation(); createTask(status) }} style={{ color: 'var(--na-text-tertiary)' }}>
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md shrink-0 order-2" style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-tertiary)' }}>
                        {statusTasks.length}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="ml-4 space-y-0.5">
                        {statusTasks.length === 0 && (
                          <div className="text-[12px] px-3 py-1.5" style={{ color: 'var(--na-text-tertiary)' }}>{t('noTasksShort')}</div>
                        )}
                        {statusTasks.map((task) => (
                          <div key={task.id} className="relative">
                            {editingTaskId === task.id ? (
                              <div className="flex items-center gap-2 px-2 py-1">
                                {currentTaskId === task.id && (
                                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: 'var(--na-accent)' }} />
                                )}
                                <button onClick={(e) => { e.stopPropagation(); cycleStatus(task.id, task.status || 'todo') }} className="shrink-0 w-4 h-4 flex items-center justify-center">
                                  {task.status === 'done' ? (
                                    <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: task.status === 'in_progress' ? '#2563EB' : 'var(--na-border-default)' }} />
                                  )}
                                </button>
                                <input
                                  ref={taskInputRef}
                                  type="text"
                                  defaultValue={task.title}
                                  onBlur={() => renameTask(task.id)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') renameTask(task.id); if (e.key === 'Escape') setEditingTaskId(null) }}
                                  onFocus={(e) => e.target.select()}
                                  className="flex-1 text-[13px] outline-none px-1.5 py-0.5"
                                  style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                                  autoFocus
                                />
                                {streamingTaskIds.has(task.id) && (
                                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin ml-auto" style={{ color: 'var(--na-status-explore)' }} />
                                )}
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors group rounded-lg"
                                style={{ background: currentTaskId === task.id ? 'var(--na-bg-active)' : 'transparent' }}
                                onClick={() => selectTask(task)}
                                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', id: task.id }) }}
                              >
                                {currentTaskId === task.id && (
                                  <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: 'var(--na-accent)' }} />
                                )}
                                <button onClick={(e) => { e.stopPropagation(); cycleStatus(task.id, task.status || 'todo') }} className="shrink-0 w-4 h-4 flex items-center justify-center">
                                  {task.status === 'done' ? (
                                    <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: task.status === 'in_progress' ? '#2563EB' : 'var(--na-border-default)' }} />
                                  )}
                                </button>
                                <span className="flex-1 text-[13px] truncate" style={{
                                  color: currentTaskId === task.id ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                                  textDecoration: task.status === 'done' ? 'line-through' : 'none',
                                  opacity: task.status === 'done' ? 0.6 : 1,
                                }}>
                                  {task.title}
                                </span>
                                {streamingTaskIds.has(task.id) && (
                                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin ml-auto" style={{ color: 'var(--na-status-explore)' }} />
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Custom Folders */}
              {taskFolders.length > 0 && (
                <>
                  <div className="mx-2 my-2" style={{ height: 1, background: 'var(--na-border-subtle)' }} />
                  {taskFolders.map((folder) => {
                    const folderTasks = tasksInFolder(folder.id)
                    const isExpanded = expandedFolders[folder.id] !== false
                    const isEditing = editingFolderId === folder.id
                    return (
                      <div key={folder.id} className="mb-0.5">
                        <div
                          className="flex items-center gap-2 px-2.5 py-1.5 transition-colors group rounded-lg"
                          style={{ background: 'transparent', cursor: isEditing ? 'default' : 'pointer' }}
                          onClick={isEditing ? undefined : () => toggleFolder(folder.id)}
                          onContextMenu={isEditing ? undefined : (e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', id: folder.id }) }}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />}
                          <Folder className="w-4 h-4 shrink-0" style={{ color: 'var(--na-status-execute)' }} />
                          {isEditing ? (
                            <input
                              ref={folderInputRef}
                              type="text"
                              defaultValue={folder.name}
                              onBlur={() => renameFolder(folder.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') renameFolder(folder.id); if (e.key === 'Escape') setEditingFolderId(null) }}
                              onFocus={(e) => e.target.select()}
                              className="flex-1 text-[13px] outline-none px-1.5 py-0.5"
                              style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                              autoFocus
                            />
                          ) : (
                            <span className="flex-1 text-[13px] font-medium truncate" style={{ color: 'var(--na-text-primary)' }}>{folder.name}</span>
                          )}
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md shrink-0" style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-tertiary)' }}>
                            {folderTasks.length}
                          </span>
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0" onClick={(e) => { e.stopPropagation(); createTask(undefined, folder.id) }} style={{ color: 'var(--na-text-tertiary)' }}>
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="ml-4 space-y-0.5">
                            {folderTasks.length === 0 && (
                              <div className="text-[12px] px-3 py-1.5" style={{ color: 'var(--na-text-tertiary)' }}>{t('noTasksShort')}</div>
                            )}
                            {folderTasks.map((task) => (
                              <div key={task.id} className="relative">
                                {editingTaskId === task.id ? (
                                  <div className="flex items-center gap-2 px-2 py-1">
                                    {currentTaskId === task.id && (
                                      <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: 'var(--na-accent)' }} />
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); cycleStatus(task.id, task.status || 'todo') }} className="shrink-0 w-4 h-4 flex items-center justify-center">
                                      {task.status === 'done' ? (
                                        <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                                      ) : (
                                        <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: task.status === 'in_progress' ? '#2563EB' : 'var(--na-border-default)' }} />
                                      )}
                                    </button>
                                    <input
                                      ref={taskInputRef}
                                      type="text"
                                      defaultValue={task.title}
                                      onBlur={() => renameTask(task.id)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') renameTask(task.id); if (e.key === 'Escape') setEditingTaskId(null) }}
                                      onFocus={(e) => e.target.select()}
                                      className="flex-1 text-[13px] outline-none px-1.5 py-0.5"
                                      style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                                      autoFocus
                                    />
                                    {streamingTaskIds.has(task.id) && (
                                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin ml-auto" style={{ color: 'var(--na-status-explore)' }} />
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    className="flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors group rounded-lg"
                                    style={{ background: currentTaskId === task.id ? 'var(--na-bg-active)' : 'transparent' }}
                                    onClick={() => selectTask(task)}
                                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', id: task.id }) }}
                                  >
                                    {currentTaskId === task.id && (
                                      <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: 'var(--na-accent)' }} />
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); cycleStatus(task.id, task.status || 'todo') }} className="shrink-0 w-4 h-4 flex items-center justify-center">
                                      {task.status === 'done' ? (
                                        <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                                      ) : (
                                        <div className="w-3.5 h-3.5 rounded-full border" style={{ borderColor: task.status === 'in_progress' ? '#2563EB' : 'var(--na-border-default)' }} />
                                      )}
                                    </button>
                                    <span className="flex-1 text-[13px] truncate" style={{
                                      color: currentTaskId === task.id ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                                      textDecoration: task.status === 'done' ? 'line-through' : 'none',
                                      opacity: task.status === 'done' ? 0.6 : 1,
                                    }}>
                                      {task.title}
                                    </span>
                                    {streamingTaskIds.has(task.id) && (
                                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin ml-auto" style={{ color: 'var(--na-status-explore)' }} />
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </NavSection>

            {/* Divider */}
            <div className="mx-3 my-2" style={{ height: 1, background: 'var(--na-border-subtle)' }} />

            {/* Workspaces */}
            <NavSection title={t('workspace')}>
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] cursor-pointer transition-colors rounded-lg group"
                  style={{
                    background: currentWorkspaceId === ws.id ? 'var(--na-bg-active)' : 'transparent',
                    color: currentWorkspaceId === ws.id ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                  }}
                  onClick={() => setCurrentWorkspaceId(ws.id)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'workspace', id: ws.id }) }}
                >
                  <Folder className="w-4 h-4 shrink-0" style={{ color: currentWorkspaceId === ws.id ? 'var(--na-accent)' : 'var(--na-text-tertiary)' }} />
                  <span className="truncate flex-1">{ws.name}</span>
                </div>
              ))}
              <button
                onClick={importWorkspace}
                className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] transition-colors rounded-lg w-full"
                style={{ color: 'var(--na-text-tertiary)' }}
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>{t('importFolder')}</span>
              </button>
            </NavSection>

            <div className="mx-3 my-2" style={{ height: 1, background: 'var(--na-border-subtle)' }} />

            <NavSection title={t('web')}>
              <DataSourceItem icon={Globe} label="API" onClick={() => { setManagerTab('api'); setManagerOpen(true) }} />
              <DataSourceItem icon={Cable} label="MCP" onClick={() => { setManagerTab('mcp'); setManagerOpen(true) }} onAdd={() => createCreationTask('MCP')} />
            </NavSection>

            {/* Knowledge Base */}
            <div className="mx-3 my-2" style={{ height: 1, background: 'var(--na-border-subtle)' }} />
            <NavSection title={t('knowledgeBase')}>
              {kbFolders.length === 0 && (
                <div className="px-2.5 py-1 text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
                  {t('noKbFoldersIndexed')}
                </div>
              )}
              {kbFolders.map((folder) => (
                <div key={folder.id} className="group flex items-center gap-1">
                  <button
                    className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-lg transition-colors text-left hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-secondary)' }}
                    title={folder.path}
                  >
                    <HardDrive className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    <span className="flex-1 truncate">{folder.name}</span>
                    {folder.last_indexed_at ? (
                      <span className="text-[10px] opacity-60">
                        {new Date(folder.last_indexed_at * 1000).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-[10px] opacity-60">{t('notIndexed')}</span>
                    )}
                  </button>
                  <button
                    onClick={() => indexKbFolder(folder.id)}
                    disabled={kbIndexing.has(folder.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0"
                    style={{ color: 'var(--na-text-tertiary)' }}
                    title={t('reindex')}
                  >
                    {kbIndexing.has(folder.id) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => removeKbFolder(folder.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0"
                    style={{ color: 'var(--na-text-tertiary)' }}
                    title={t('remove')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={addKbFolder}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors rounded-lg w-full hover:bg-[var(--na-bg-hover)]"
                style={{ color: 'var(--na-text-tertiary)' }}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{t('addFolder')}</span>
              </button>
            </NavSection>

            <NavSection title={t('skills')}>
              <SkillItem label={t('workspaceSkills')} onClick={() => { setManagerTab('skills'); setManagerOpen(true) }} onAdd={() => createCreationTask('Skill')} />
              {/* Report Generation */}
              {reportEnabled && (
                <div className="relative">
                  <div
                    className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-lg cursor-pointer transition-colors group"
                    style={{ color: 'var(--na-text-secondary)' }}
                    onClick={() => {
                      setReportExpanded(!reportExpanded)
                      if (!reportExpanded) loadReports()
                    }}
                  >
                    {reportExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    )}
                    <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    <span className="flex-1 truncate">{t('reportGeneration')}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setReportModalOpen(true) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0"
                      style={{ color: 'var(--na-text-tertiary)' }}
                      title={t('newReportTooltip')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {reportExpanded && (
                    <div className="ml-6 space-y-0.5">
                      {reports.length === 0 && (
                        <div className="text-[11px] px-2 py-1.5" style={{ color: 'var(--na-text-tertiary)' }}>{t('noReports')}</div>
                      )}
                      {reports.map((r) => (
                        <div key={r.path}>
                          {editingReportPath === r.path ? (
                            <div className="flex items-center gap-2 px-2 py-1">
                              <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                              <input
                                type="text"
                                defaultValue={r.name}
                                onBlur={async (e) => {
                                  const newName = e.target.value.trim()
                                  if (newName && newName !== r.name && reportDir) {
                                    const result = await window.electronAPI.renameFile(reportDir, r.name, newName)
                                    if (result.success) {
                                      toast.success(t('renamed'))
                                      loadReports()
                                    } else {
                                      toast.error(t('renameFailed') + ': ' + (result.error || t('unknownError')))
                                    }
                                  }
                                  setEditingReportPath(null)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  if (e.key === 'Escape') setEditingReportPath(null)
                                }}
                                onFocus={(e) => e.target.select()}
                                autoFocus
                                className="flex-1 text-[12px] outline-none px-1.5 py-0.5"
                                style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                window.dispatchEvent(new CustomEvent('file-tree:open-absolute', { detail: r.path }))
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setReportContextMenu({ x: e.clientX, y: e.clientY, report: r })
                              }}
                              className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-[12px] transition-colors rounded-lg"
                              style={{ color: 'var(--na-text-secondary)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--na-bg-hover)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                              <span className="truncate">{r.name}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </NavSection>

          </div>
        )}
      </div>

      {/* Bottom Section */}
      <div className="shrink-0 px-3 py-3 space-y-1" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={onOpenSettings} className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }} title={`${t('settings')} (Cmd+,)`}>
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Manager Modal */}
      <ManagerModal
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        workspacePath={workspaces.find((w) => w.id === currentWorkspaceId)?.path || ''}
        initialTab={managerTab}
        onCreateNew={(type) => {
          setManagerOpen(false)
          if (type === 'skills') createCreationTask('Skill')
          else if (type === 'mcp') createCreationTask('MCP')
          else if (type === 'api') createCreationTask('API')
        }}
      />

      {/* Report Generate Modal */}
      <ReportGenerateModal
        open={reportModalOpen}
        onClose={() => { setReportModalOpen(false); loadReports() }}
        workspacePath={workspaces.find((w) => w.id === currentWorkspaceId)?.path || ''}
        tasks={tasks.filter((t) => !currentWorkspaceId || t.workspace_id === currentWorkspaceId).map((t) => ({ id: t.id, title: t.title }))}
      />

      {/* Report Context Menu */}
      {reportContextMenu && (
        <div ref={reportMenuRef} className="fixed z-50 overflow-hidden" style={{ left: reportContextMenu.x, top: reportContextMenu.y, borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)', border: '1px solid var(--na-border-subtle)', width: 160 }}>
          <button onClick={() => { setEditingReportPath(reportContextMenu.report.path); setReportContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
            <Pencil className="w-3.5 h-3.5" /> {t('rename')}
          </button>
          <button onClick={() => { window.electronAPI.deleteReport(reportContextMenu.report.path).then((result) => { if (result.success) { setReports((prev) => prev.filter((x) => x.path !== reportContextMenu!.report.path)); toast.success(t('deleted')) } else { toast.error(t('deleteFailed') + ': ' + (result.error || t('unknownError'))) } setReportContextMenu(null) }) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: '#EF4444' }}>
            <Trash2 className="w-3.5 h-3.5" /> {t('delete')}
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div ref={contextMenuRef} className="fixed z-50 overflow-hidden" style={{ left: contextMenu.x, top: contextMenu.y, borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)', border: '1px solid var(--na-border-subtle)', width: 160 }}>
          {contextMenu.type === 'task' && (
            <>
              <button onClick={() => { const task = tasks.find((t) => t.id === contextMenu.id); if (task) { setEditingTaskId(task.id); } setContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
                <Pencil className="w-3.5 h-3.5" /> {t('rename')}
              </button>
              <button onClick={() => { const task = tasks.find((t) => t.id === contextMenu.id); if (task) cycleStatus(task.id, task.status || 'todo'); setContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
                <Circle className="w-3.5 h-3.5" /> {t('switchStatus')}
              </button>
              <button onClick={() => deleteTask(contextMenu.id)} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: '#EF4444' }}>
                <Trash2 className="w-3.5 h-3.5" /> {t('delete')}
              </button>
            </>
          )}
          {contextMenu.type === 'folder' && (
            <>
              <button onClick={() => { const folder = taskFolders.find((f) => f.id === contextMenu.id); if (folder) { setEditingFolderId(folder.id); } setContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
                <Pencil className="w-3.5 h-3.5" /> {t('rename')}
              </button>
              <button onClick={() => { createTask(undefined, contextMenu.id); setContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
                <Plus className="w-3.5 h-3.5" /> {t('createTaskHere')}
              </button>
              <button onClick={() => deleteFolder(contextMenu.id)} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: '#EF4444' }}>
                <Trash2 className="w-3.5 h-3.5" /> {t('deleteFolder')}
              </button>
            </>
          )}
          {contextMenu.type === 'workspace' && (
            <>
              <div className="px-3 py-1.5 text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>{t('defaultModelTier')}</div>
              {[
                { key: null as string | null, label: t('noDefaultTier'), color: 'var(--na-text-tertiary)' },
                { key: 'fast', label: t('fast'), color: '#059669' },
                { key: 'balanced', label: t('balanced'), color: '#F59E0B' },
                { key: 'strong', label: t('strong'), color: '#EF4444' },
              ].map((tier) => {
                const ws = workspaces.find((w) => w.id === contextMenu!.id)
                const isActive = (ws?.model_tier || null) === tier.key
                return (
                  <button
                    key={tier.key ?? 'none'}
                    onClick={async () => {
                      await window.electronAPI.updateWorkspaceModelTier(contextMenu!.id, tier.key)
                      const updated = await window.electronAPI.getWorkspaces()
                      setWorkspaces(updated)
                      setContextMenu(null)
                    }}
                    className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2"
                    style={{ color: isActive ? tier.color : 'var(--na-text-secondary)' }}
                  >
                    {isActive && <Check className="w-3 h-3" />}
                    {!isActive && <span className="w-3 h-3" />}
                    {tier.label}
                  </button>
                )
              })}
              <div className="my-1" style={{ borderTop: '1px solid var(--na-border-subtle)' }} />
              <button
                onClick={() => {
                  const ws = workspaces.find((w) => w.id === contextMenu!.id)
                  if (ws) {
                    window.dispatchEvent(new CustomEvent('file-tree:open-absolute', { detail: `${ws.path}/.note_agent/NOTEAGENT.md` }))
                  }
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2"
                style={{ color: 'var(--na-text-primary)' }}
              >
                <FileText className="w-3.5 h-3.5" /> {t('editProjectMemory')}
              </button>
              <button onClick={() => deleteWorkspace(contextMenu.id)} className="w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2" style={{ color: '#EF4444' }}>
                <Trash2 className="w-3.5 h-3.5" /> {t('deleteWorkspace')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FileTreeView({ workspace, currentFile, onSelectFile }: { workspace: Workspace; currentFile: string | undefined; onSelectFile: (path: string) => void }) {
  const { t } = useT()
  const [tree, setTree] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['__root__']))
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; entry: any } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingFileDir, setCreatingFileDir] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const fileMenuRef = useRef<HTMLDivElement>(null)

  // Listen for global escape to cancel editing states
  useEffect(() => {
    const handler = () => {
      setRenamingEntry(null)
      setCreatingFileDir(null)
      setNewFileName('')
      setFileContextMenu(null)
    }
    window.addEventListener('file-tree:cancel-editing', handler)
    return () => window.removeEventListener('file-tree:cancel-editing', handler)
  }, [])

  // Load persisted expansion state for this workspace
  useEffect(() => {
    try {
      const key = `na:filetree:expanded:${workspace.id}`
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          setExpanded(new Set(parsed))
        }
      } else {
        // Default: root expanded
        setExpanded(new Set(['__root__']))
      }
    } catch {}
  }, [workspace.id])

  // Persist expansion state
  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      try {
        localStorage.setItem(`na:filetree:expanded:${workspace.id}`, JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
  }

  const refresh = async () => {
    setLoading(true)
    const result = await window.electronAPI.listFiles(workspace.path)
    if (!result.error) setTree(result.entries)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [workspace.path])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileContextMenu(null)
      }
    }
    if (fileContextMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fileContextMenu])

  const handleRename = async (oldPath: string, oldName: string) => {
    if (!renameValue.trim() || renameValue.trim() === oldName) {
      setRenamingEntry(null)
      return
    }
    const dir = window.electronAPI.pathDirname(oldPath)
    const result = await window.electronAPI.renameFile(workspace.path, oldPath, dir ? window.electronAPI.pathJoin(dir, renameValue.trim()) : renameValue.trim())
    if (result.success) {
      toast.success(t('renamed'))
      const refreshed = await window.electronAPI.listFiles(workspace.path)
      if (!refreshed.error) setTree(refreshed.entries)
    } else {
      toast.error(t('renameFailed') + ': ' + result.error)
    }
    setRenamingEntry(null)
  }

  const handleDelete = async (entry: any) => {
    const result = await window.electronAPI.deleteFile(workspace.path, entry.path)
    if (result.success) {
      toast.success(t('deleted'))
      const refreshed = await window.electronAPI.listFiles(workspace.path)
      if (!refreshed.error) setTree(refreshed.entries)
      // Notify Editor to close the tab for this file
      window.dispatchEvent(new CustomEvent('file:deleted', { detail: { path: entry.path } }))
    } else {
      toast.error(t('deleteFailed') + ': ' + result.error)
    }
    setFileContextMenu(null)
  }

  const handleCopyPath = (entry: any) => {
    navigator.clipboard.writeText(window.electronAPI.pathJoin(workspace.path, entry.path))
    toast.success(t('pathCopied'))
    setFileContextMenu(null)
  }

  const handleCopyName = (entry: any) => {
    navigator.clipboard.writeText(entry.name)
    toast.success(t('filenameCopied'))
    setFileContextMenu(null)
  }

  const handleCreateFile = async (dirPath: string) => {
    const name = newFileName.trim()
    if (!name) {
      setCreatingFileDir(null)
      setNewFileName('')
      return
    }
    const fullPath = dirPath ? window.electronAPI.pathJoin(dirPath, name) : name
    const absolutePath = window.electronAPI.pathJoin(workspace.path, fullPath)
    const result = await window.electronAPI.writeFile(absolutePath, '')
    if (result.success) {
      toast.success(t('fileCreated'))
      const refreshed = await window.electronAPI.listFiles(workspace.path)
      if (!refreshed.error) setTree(refreshed.entries)
      onSelectFile(fullPath)
    } else {
      toast.error(t('createFailed') + ': ' + result.error)
    }
    setCreatingFileDir(null)
    setNewFileName('')
  }

  const renderEntries = (entries: any[], depth = 0): JSX.Element[] => {
    return entries.map((entry) => {
      const isDir = entry.type === 'directory'
      const isExpanded = expanded.has(entry.path)
      const isActive = currentFile && entry.path.endsWith(currentFile)
      const isRenaming = renamingEntry?.path === entry.path

      return (
        <div key={entry.path}>
          {isRenaming ? (
            <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: 8 + depth * 14 }}>
              {isDir ? <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} /> : <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />}
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRename(entry.path, entry.name)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(entry.path, entry.name); if (e.key === 'Escape') setRenamingEntry(null) }}
                className="flex-1 text-[12px] outline-none px-1.5 py-0.5"
                style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => { if (isDir) { toggleExpand(entry.path) } else { onSelectFile(entry.path) } }}
              onContextMenu={(e) => { e.preventDefault(); setFileContextMenu({ x: e.clientX, y: e.clientY, entry }) }}
              className="flex items-center gap-1 w-full py-1 text-[12px] transition-colors"
              style={{ paddingLeft: 8 + depth * 12, borderRadius: 'var(--na-radius-sm)', background: isActive ? 'var(--na-bg-active)' : 'transparent', color: isActive ? 'var(--na-accent)' : 'var(--na-text-secondary)' }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--na-bg-hover)' }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              draggable={!isDir}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', entry.path) }}
              onDragOver={(e) => { if (isDir) e.preventDefault() }}
              onDrop={(e) => {
                if (isDir) {
                  e.preventDefault()
                  const draggedPath = e.dataTransfer.getData('text/plain')
                  if (draggedPath && draggedPath !== entry.path) {
                    window.electronAPI.moveFile(workspace.path, draggedPath, entry.path).then((result) => {
                      if (result.success) {
                        window.electronAPI.listFiles(workspace.path).then((r) => { if (!r.error) setTree(r.entries) })
                      }
                    })
                  }
                }
              }}
            >
              {isDir ? (
                <>
                  {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} /> : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />}
                  <Folder className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <FileCode className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          )}
          {isDir && creatingFileDir === entry.path && (
            <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onBlur={() => handleCreateFile(entry.path)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(entry.path); if (e.key === 'Escape') { setCreatingFileDir(null); setNewFileName('') } }}
                className="flex-1 text-[12px] outline-none px-1.5 py-0.5"
                style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
                autoFocus
                placeholder={t('filenamePlaceholder')}
              />
            </div>
          )}
          {isDir && isExpanded && entry.children && (
            <div>{renderEntries(entry.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  if (loading) {
    return (
      <div className="space-y-1 px-1 py-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-1.5 py-1 px-2">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--na-bg-active)' }} />
            <div className="h-2.5 rounded-sm flex-1" style={{ background: 'var(--na-bg-active)' }} />
          </div>
        ))}
      </div>
    )
  }

  const rootExpanded = expanded.has('__root__')
  const rootName = workspace.name

  return (
    <div>
      {/* Hidden refresh trigger */}
      <button id="file-tree-refresh-trigger" className="hidden" onClick={refresh} />
      {/* Root folder node */}
      <button
        onClick={() => toggleExpand('__root__')}
        onContextMenu={(e) => {
          e.preventDefault()
          setFileContextMenu({ x: e.clientX, y: e.clientY, entry: { path: '', name: rootName, type: 'directory' } })
        }}
        className="flex items-center gap-1 w-full py-1 text-[12px] font-medium transition-colors"
        style={{ paddingLeft: 8, borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--na-bg-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {rootExpanded ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} /> : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />}
        <Folder className="w-3 h-3 shrink-0" style={{ color: 'var(--na-accent)' }} />
        <span className="truncate">{rootName}</span>
      </button>
      {/* New file input for root directory */}
      {creatingFileDir === '' && (
        <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: 8 + 14 }}>
          <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onBlur={() => handleCreateFile('')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(''); if (e.key === 'Escape') { setCreatingFileDir(null); setNewFileName('') } }}
            className="flex-1 text-[12px] outline-none px-1.5 py-0.5"
            style={{ background: 'var(--na-bg-panel)', borderRadius: 'var(--na-radius-sm)', color: 'var(--na-text-primary)', border: '1px solid var(--na-accent)' }}
            autoFocus
            placeholder={t('filenamePlaceholder')}
          />
        </div>
      )}
      {rootExpanded && tree && (
        <div>{renderEntries(tree, 1)}</div>
      )}

      {/* File / Folder context menu */}
      {fileContextMenu && (
        <div ref={fileMenuRef} className="fixed z-50 overflow-hidden" style={{ left: fileContextMenu.x, top: fileContextMenu.y, borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)', border: '1px solid var(--na-border-subtle)', width: 160 }}>
          {fileContextMenu.entry.type === 'directory' && (
            <button onClick={() => { setCreatingFileDir(fileContextMenu.entry.path); setNewFileName(''); setFileContextMenu(null); if (!expanded.has(fileContextMenu.entry.path)) toggleExpand(fileContextMenu.entry.path) }} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
              <FilePlus className="w-3 h-3" /> {t('newFile')}
            </button>
          )}
          <button onClick={() => { setRenamingEntry({ path: fileContextMenu.entry.path, name: fileContextMenu.entry.name }); setRenameValue(fileContextMenu.entry.name); setFileContextMenu(null) }} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
            <Pencil className="w-3 h-3" /> {t('rename')}
          </button>
          {fileContextMenu.entry.type !== 'directory' && (
            <button onClick={() => handleCopyName(fileContextMenu.entry)} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
              <Copy className="w-3 h-3" /> {t('copyFilename')}
            </button>
          )}
          <button onClick={() => handleCopyPath(fileContextMenu.entry)} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2" style={{ color: 'var(--na-text-primary)' }}>
            <Copy className="w-3 h-3" /> {t('copyPath')}
          </button>
          <div className="mx-2" style={{ height: 1, background: 'var(--na-border-subtle)' }} />
          <button onClick={() => handleDelete(fileContextMenu.entry)} className="w-full text-left px-3 py-1.5 text-[12px] transition-colors flex items-center gap-2" style={{ color: '#EF4444' }}>
            <Trash2 className="w-3 h-3" /> {t('delete')}
          </button>
        </div>
      )}
    </div>
  )
}


// ── Sidebar helper components ──

// DataSourceItem and SkillItem now live in `./sidebar/items.tsx`.
