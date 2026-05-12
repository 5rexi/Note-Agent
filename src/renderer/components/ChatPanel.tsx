import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { AgentEvent } from '../../agent'
import { useAtom, useAtomValue } from 'jotai'
import { useT } from '../hooks/useT'
import {
  messagesAtom,
  currentSessionAtom,
  currentTaskAtom,
  currentWorkspaceAtom,
  editorStateAtom,
  currentFilePathAtom,
  tasksAtom,
  streamingTaskIdAtom,
  streamingTaskIdsAtom,
  sessionStreamingStatesAtom,
  type SessionStreamingState,
} from '../atoms'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {
  Send, Paperclip, PanelRightClose, Plus, X, Sparkles, Zap, Terminal,
  ChevronDown, ChevronUp, Cable, Folder, Loader2, Flame, Copy, Check,
  Wrench, AlertCircle,
  Trash2, Square, Quote, FlaskConical, RotateCcw,
} from 'lucide-react'
import ModelSelector from './ModelSelector'
import { CollapsibleQuote, parseMessageWithQuotes } from './chat/CollapsibleQuote'
import {
  mergeAssistantMessages,
  FoldableSection,
  modeConfig,
  statusConfig,
  toolIcons,
  getLastLine,
  extractMetadata,
} from './chat'

import type { Message as ChatMessage } from '../atoms'
import type { Task } from '../atoms'

interface Attachment {
  id: string
  name: string
  type: 'text' | 'image'
  content: string
  mediaType?: string
}

interface TextQuote {
  id: string
  fileName: string
  filePath: string
  preview: string
  fullText: string
  type: 'word' | 'code' | 'markdown' | 'latex'
  paragraphs: Array<{ index: number; text: string; style?: string; lineStart: number; lineEnd: number }>
  range?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
}

import type { ProviderConfig } from '../lib/providers'

// modeConfig, statusConfig, toolIcons, getLastLine, extractMetadata, FoldableSection,
// mergeAssistantMessages now live in `./chat`.
// ── Render AI message content (history) ──
function AiMessageContent({ content, toolCalls: toolCallsProp, onApplyToDocx }: { content: string; toolCalls?: any[]; onApplyToDocx?: () => void }) {
  const { t } = useT()
  // Legacy: parse HTML comment metadata for old messages
  const { content: cleanContent, metadata } = extractMetadata(content)
  const thinkFromMeta = metadata.thinkContent || ''
  const toolCallsFromMeta = metadata.toolCalls || []

  // Prefer new format toolCalls, fallback to legacy metadata
  const displayToolCalls = toolCallsProp?.length ? toolCallsProp : toolCallsFromMeta
  const body = cleanContent

  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div>
      {/* Think section (legacy metadata only — new system doesn't store think in DB yet) */}
      {thinkFromMeta && (
        <div className="mb-3 overflow-hidden" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-active)' }}>
          <FoldableSection title={t('thinkingProcess')} lastLine={getLastLine(thinkFromMeta)} defaultOpen={false}>
            {thinkFromMeta}
          </FoldableSection>
        </div>
      )}
      {/* Tool call history */}
      {displayToolCalls.length > 0 && (
        <div className="mb-3 overflow-hidden" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-active)' }}>
          <FoldableSection title={t('toolCalls')} lastLine={t('toolCallsCount', { count: String(displayToolCalls.length) })} defaultOpen={true}>
            <div className="space-y-1.5">
              {displayToolCalls.map((tc: any) => {
                const Icon = toolIcons[tc.name] || Wrench
                const statusColor: Record<string, string> = {
                  running: '#2563EB',
                  completed: '#059669',
                  failed: '#ef4444',
                  confirming: '#2563EB',
                  'needs-confirmation': '#f59e0b',
                  rejected: '#ef4444',
                }
                const color = statusColor[tc.status] || 'var(--na-text-tertiary)'
                const label: Record<string, string> = {
                  running: t('toolStatusRunning'),
                  completed: t('toolStatusCompleted'),
                  failed: t('toolStatusFailed'),
                  confirming: t('toolStatusConfirming'),
                  'needs-confirmation': t('toolStatusNeedsConfirmation'),
                  rejected: t('toolStatusRejected'),
                }
                return (
                  <div key={tc.id || tc.toolCallId} className="flex items-center gap-2 text-[12px]">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    <span className="font-medium" style={{ color: 'var(--na-text-secondary)' }}>{tc.name}</span>
                    {tc.args?.path && <span className="opacity-50">— {tc.args.path}</span>}
                    <span className="ml-auto flex items-center gap-1 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      {label[tc.status] || tc.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </FoldableSection>
        </div>
      )}
      {body && (
        <div className="markdown-body text-[13px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {body}
          </ReactMarkdown>
        </div>
      )}
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 mt-2 px-2 py-1 text-[11px] rounded-md transition-colors opacity-0 group-hover:opacity-100 hover:bg-[var(--na-bg-hover)]"
        style={{ color: 'var(--na-text-tertiary)' }}
        title={t('copyRawContent')}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? t('copied') : t('copy')}
      </button>
      {onApplyToDocx && (
        <button
          onClick={onApplyToDocx}
          className="flex items-center gap-1 mt-1 px-2 py-1 text-[11px] rounded-md transition-colors opacity-0 group-hover:opacity-100 hover:bg-[var(--na-bg-hover)]"
          style={{ color: '#7C3AED' }}
          title={t('applyToDocx')}
        >
          <Check className="w-3 h-3" />
          {t('applyToDocx')}
        </button>
      )}
    </div>
  )
}

// ── Streaming work card ──
function StreamingCard({
  content,
  mode,
  thinkContent,
  isThinking,
  isStreaming,
  toolCalls,
  todos,
  todoProgress,
}: {
  content: string
  mode: 'explore' | 'ask' | 'execute' | 'research' | null
  thinkContent: string
  isThinking: boolean
  isStreaming: boolean
  toolCalls: Array<{ id: string; name: string; args: any; status: string; result?: any; isSubagent?: boolean }>
  todos?: Array<{ text: string; completed: boolean }>
  todoProgress?: { completed: number; total: number }
}) {
  const { t } = useT()
  const [thinkExpanded, setThinkExpanded] = useState(false)
  const thinkLastLine = thinkContent ? getLastLine(thinkContent) : undefined

  // Determine the status label for the fold header
  const runningTool = toolCalls.find((t) => t.status === 'running')
  const needsConfirmTool = toolCalls.find((t) => t.status === 'needs-confirmation')
  const foldLabel = runningTool
    ? t('callingTool', { name: runningTool.name })
    : needsConfirmTool
      ? t('waitingConfirmTool', { name: needsConfirmTool.name })
      : isThinking
        ? t('thinking')
        : thinkContent
          ? t('thinkingProcess')
          : t('processing')

  return (
    <div className="flex-1 min-w-0">
      <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--na-text-secondary)' }}>
        Note Agent
      </div>

      {/* Work-in-progress card */}
      <div
        className="mb-3 overflow-hidden"
        style={{
          borderRadius: 'var(--na-radius-md)',
          border: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-active)',
        }}
      >
        {/* Header: cooking status */}
        <div className="flex items-center gap-2 px-3 py-2">
          {isStreaming ? (
            <>
              <Flame
                className="w-3.5 h-3.5 shrink-0"
                style={{
                  color: mode ? modeConfig[mode].color : 'var(--na-status-explore)',
                }}
              />
              <span
                className="text-[11px] font-medium"
                style={{ color: 'var(--na-text-secondary)' }}
              >
                {isThinking ? t('thinking') : needsConfirmTool ? t('waitingConfirmShort') : t('cooking')}
              </span>
              <Loader2
                className="w-3 h-3 shrink-0 animate-spin"
                style={{ color: 'var(--na-text-tertiary)' }}
              />
            </>
          ) : toolCalls.length > 0 ? (
            <>
              {toolCalls.some((t) => t.status === 'rejected') ? (
                <X className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
              ) : (
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: '#059669' }} />
              )}
              <span
                className="text-[11px] font-medium"
                style={{ color: 'var(--na-text-secondary)' }}
              >
                {toolCalls.some((tc) => tc.status === 'rejected') ? t('terminated') : t('toolStatusCompleted')}
              </span>
            </>
          ) : null}
        </div>

        {/* Think + Tools foldable section */}
        {(thinkContent || toolCalls.length > 0) && (
          <div style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
            <button
              onClick={() => setThinkExpanded(!thinkExpanded)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors hover:bg-[var(--na-bg-hover)]"
            >
              <span
                className="text-[11px] font-medium shrink-0"
                style={{ color: 'var(--na-text-secondary)' }}
              >
                {foldLabel}
              </span>
              <span
                className="text-[11px] truncate flex-1 min-w-0"
                style={{ color: 'var(--na-text-tertiary)' }}
              >
                {thinkLastLine || ''}
              </span>
              {thinkExpanded ? (
                <ChevronUp
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: 'var(--na-text-tertiary)' }}
                />
              ) : (
                <ChevronDown
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: 'var(--na-text-tertiary)' }}
                />
              )}
            </button>
            {thinkExpanded && (
              <div
                className="px-3 pb-3 text-[12px] leading-relaxed"
                style={{ color: 'var(--na-text-secondary)' }}
              >
                {/* Last think line as summary */}
                {thinkLastLine && (
                  <div className="mb-2 pb-2" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
                    <span className="text-[11px] font-medium" style={{ color: 'var(--na-text-tertiary)' }}>{t('lastThought')}</span>
                    <span className="ml-1">{thinkLastLine}</span>
                  </div>
                )}
                {/* Todo progress */}
                {todos && todos.length > 0 && todoProgress && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--na-text-tertiary)' }}>{t('taskProgress')}</span>
                      <span className="text-[10px]" style={{ color: 'var(--na-text-secondary)' }}>
                        {todoProgress.completed}/{todoProgress.total}
                      </span>
                    </div>
                    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--na-border-subtle)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${todoProgress.total > 0 ? (todoProgress.completed / todoProgress.total) * 100 : 0}%`,
                          background: 'var(--na-accent)',
                        }}
                      />
                    </div>
                    <div className="space-y-0.5">
                      {todos.map((t, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className="w-3 h-3 flex items-center justify-center text-[9px] rounded"
                            style={{
                              background: t.completed ? 'rgba(5,150,105,0.12)' : 'var(--na-bg-hover)',
                              color: t.completed ? '#059669' : 'var(--na-text-tertiary)',
                            }}
                          >
                            {t.completed ? '✓' : '○'}
                          </span>
                          <span
                            className="truncate"
                            style={{
                              color: t.completed ? 'var(--na-text-tertiary)' : 'var(--na-text-secondary)',
                              textDecoration: t.completed ? 'line-through' : 'none',
                            }}
                          >
                            {t.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Tool call history */}
                {toolCalls.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium" style={{ color: 'var(--na-text-tertiary)' }}>{t('toolCallHistory')}</span>
                    {toolCalls.map((tc) => {
                      const Icon = toolIcons[tc.name] || Wrench
                      const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
                        running: { label: t('toolStatusRunning'), color: 'var(--na-status-explore)', bg: 'rgba(37,99,235,0.08)', icon: Loader2 },
                        completed: { label: t('toolStatusCompleted'), color: '#059669', bg: 'rgba(5,150,105,0.08)', icon: Check },
                        failed: { label: t('toolStatusFailed'), color: '#ef4444', bg: 'rgba(239,68,68,0.08)', icon: X },
                        confirming: { label: t('toolStatusConfirming'), color: 'var(--na-status-explore)', bg: 'rgba(37,99,235,0.08)', icon: Loader2 },
                        'needs-confirmation': { label: t('toolStatusNeedsConfirmation'), color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: AlertCircle },
                      }
                      const cfg = statusConfig[tc.status] || { label: tc.status, color: 'var(--na-text-tertiary)', bg: 'var(--na-bg-hover)', icon: null }
                      const StatusIcon = cfg.icon
                      return (
                        <div key={tc.id} className="text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                            {tc.isSubagent && (
                              <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>
                                subagent
                              </span>
                            )}
                            <span className="font-medium">{tc.name}</span>
                            {tc.args?.path && <span className="opacity-60">— {tc.args.path}</span>}
                            <span className="ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.color }}>
                              {StatusIcon && <StatusIcon className={`w-3 h-3 shrink-0 ${tc.status === 'running' || tc.status === 'confirming' ? 'animate-spin' : ''}`} />}
                              {cfg.label}
                            </span>
                          </div>
                          {/* Show askUserQuestion result inline */}
                          {tc.name === 'askUserQuestion' && tc.status === 'completed' && tc.result && (
                            <div className="mt-1 pl-4 py-1.5 text-[11px] rounded" style={{ background: 'rgba(5,150,105,0.06)', color: 'var(--na-text-secondary)' }}>
                              <span style={{ color: 'var(--na-text-tertiary)' }}>{t('followUp')}</span>
                              {typeof tc.result === 'string' ? tc.result : tc.result.question || JSON.stringify(tc.result)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Normal streamed response */}
      {content && (
        <div className="markdown-body text-[13px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export default function ChatPanel({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean
  onToggle: () => void
}) {
  const { t } = useT()
  const [messages, setMessages] = useAtom(messagesAtom)
  const [session, setSession] = useAtom(currentSessionAtom)
  const task = useAtomValue(currentTaskAtom)
  const [tasks, setTasks] = useAtom(tasksAtom)
  const workspace = useAtomValue(currentWorkspaceAtom)
  const [editorState] = useAtom(editorStateAtom)
  const currentFile = useAtomValue(currentFilePathAtom)
  const [streamingTaskId, setStreamingTaskId] = useAtom(streamingTaskIdAtom)
  const [streamingTaskIds, setStreamingTaskIds] = useAtom(streamingTaskIdsAtom)

  const [input, setInput] = useState('')
  const [sessionStreamingStates, setSessionStreamingStates] = useAtom(sessionStreamingStatesAtom)
  const streamingState = session?.id ? sessionStreamingStates[session.id] : undefined
  const isStreaming = streamingState?.isStreaming ?? false
  const streamingContent = streamingState?.content ?? ''
  const streamingMode = streamingState?.mode ?? null
  const thinkContent = streamingState?.thinkContent ?? ''
  const toolCalls = streamingState?.toolCalls ?? []
  const streamingError = streamingState?.error ?? null

  const [mode, setMode] = useState<'explore' | 'ask' | 'execute' | 'research'>('explore')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedTier, setSelectedTier] = useState<'weak' | 'medium' | 'strong' | 'custom' | null>(null)
  const [showModeSelect, setShowModeSelect] = useState(false)
  const [showStatusSelect, setShowStatusSelect] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [textQuotes, setTextQuotes] = useState<TextQuote[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [questionQueue, setQuestionQueue] = useState<Array<{ question: string; options?: string[] }>>([])
  const [canUndo, setCanUndo] = useState(false)
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([])
  const [currentQIndex, setCurrentQIndex] = useState(0)
  const [quickReplyInput, setQuickReplyInput] = useState('')

  // Data source selector
  const [showDataSourcePanel, setShowDataSourcePanel] = useState(false)
  const [kbFolders, setKbFolders] = useState<Array<{ id: number; path: string; name: string }>>([])
  const [userApis, setUserApis] = useState<Array<{ key: string; label: string; enabled: boolean }>>([])
  const [mcpServers, setMcpServers] = useState<Array<{ name: string }>>([])
  const [selectedDataSources, setSelectedDataSources] = useState<{
    kbFolderIds: number[]
    apis: string[]
    mcpServers: string[]
  }>({ kbFolderIds: [], apis: [], mcpServers: [] })

  // Load data sources for panel
  useEffect(() => {
    window.electronAPI.kbListFolders().then((folders) => {
      setKbFolders(folders.map((f: any) => ({ id: f.id, path: f.path, name: f.name })))
    }).catch(() => {})

    // Load user-defined APIs from workspace/.note_agent/apis/
    const loadApis = async () => {
      if (!workspace?.path) { setUserApis([]); return }
      const base = window.electronAPI.pathJoin(workspace.path, '.note_agent', 'apis')
      const result = await window.electronAPI.listFiles(base)
      const apis: Array<{ key: string; label: string; enabled: boolean }> = []
      if (!result.error && result.entries) {
        for (const entry of result.entries) {
          if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
          const readResult = await window.electronAPI.readFile(`${base}/${entry.name}`)
          if (readResult.error) continue
          try {
            const config = JSON.parse(readResult.content)
            const id = entry.name.replace(/\.json$/, '')
            apis.push({ key: id, label: config.name || id, enabled: true })
          } catch { /* ignore parse error */ }
        }
      }
      setUserApis(apis)
    }
    loadApis().catch(() => setUserApis([]))

    // Load MCP servers from ~/.note_agent/mcp.json
    const loadMCPs = async () => {
      const homeResult = await window.electronAPI.getHomeDir?.()
      const homeDir = homeResult || ''
      const result = await window.electronAPI.readFile(window.electronAPI.pathJoin(homeDir, '.note_agent', 'mcp.json'))
      if (result.error) { setMcpServers([]); return }
      try {
        const config = JSON.parse(result.content)
        const servers = (config.servers || []).map((s: any) => ({ name: s.name || s.id || 'unnamed' }))
        setMcpServers(servers)
      } catch { setMcpServers([]) }
    }
    loadMCPs().catch(() => setMcpServers([]))
  }, [workspace?.path])

  // Derived: current pending question for UI
  const pendingQuestion = questionQueue.length > 0 && currentQIndex < questionQueue.length
    ? questionQueue[currentQIndex]
    : null
  const bottomRef = useRef<HTMLDivElement>(null)

  // Refs for event handler to avoid stale closures
  const toolCallsRef = useRef(toolCalls)
  useEffect(() => { toolCallsRef.current = toolCalls }, [toolCalls])

  // ── @File mention popup ──
  const [showAtPopup, setShowAtPopup] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atResults, setAtResults] = useState<string[]>([])
  const [atSelectedIndex, setAtSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atMatchRef = useRef<{ start: number; end: number } | null>(null)
  const dataSourceBtnRectRef = useRef<DOMRect | null>(null)

  // ── /Skill slash command popup ──
  const [showSkillPopup, setShowSkillPopup] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const [skillResults, setSkillResults] = useState<Array<{ id: string; name: string }>>([])
  const [skillSelectedIndex, setSkillSelectedIndex] = useState(0)
  const skillMatchRef = useRef<{ start: number; end: number } | null>(null)
  const [allSkills, setAllSkills] = useState<Array<{ id: string; name: string }>>([])

  // ── Report directory detection ──
  const [reportDir, setReportDir] = useState<string>('')

  // ── Refs for stable IPC handler (never re-subscribe) ──
  const sessionRef = useRef(session)
  const taskRef = useRef(task)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionToTaskRef = useRef<Map<string, string>>(new Map())
  const sessionStreamingStatesRef = useRef(sessionStreamingStates)
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { taskRef.current = task }, [task])
  useEffect(() => { sessionStreamingStatesRef.current = sessionStreamingStates }, [sessionStreamingStates])

  // ── Session switch: restore mode/tier/model from session, reset input ──
  useEffect(() => {
    setInput('')
    setAttachments([])
    setShowAtPopup(false)
    setShowSkillPopup(false)
    setShowModeSelect(false)
    setShowStatusSelect(false)
    setShowDataSourcePanel(false)
    setCanUndo(false)
    if (session) {
      // Restore mode from session
      if (session.mode) setMode(session.mode)
      // Restore model/tier overrides from session
      if (session.model_override) setSelectedModel(session.model_override)
      if (session.tier_override) setSelectedTier(session.tier_override)
      // Query canUndo status for this session
      window.electronAPI.agentCanUndo(session.id).then((r) => setCanUndo(r.canUndo)).catch(() => {})
    }
    activeSessionIdRef.current = null
  }, [session?.id])

  // Load reportDir from settings
  useEffect(() => {
    async function load() {
      const saved = await window.electronAPI.getSetting('generalConfig')
      if (saved) {
        try {
          const cfg = JSON.parse(saved)
          setReportDir(cfg.reportDir || '')
        } catch {}
      }
    }
    load()
    const handler = () => load()
    window.addEventListener('settings-saved', handler)
    return () => window.removeEventListener('settings-saved', handler)
  }, [])

  // Load skills for slash command
  useEffect(() => {
    if (!workspace?.path) { setAllSkills([]); return }
    window.electronAPI.listSkills(workspace.path).then((list) => {
      setAllSkills(Array.isArray(list) ? list.map((s: any) => ({ id: s.id, name: s.name })) : [])
    }).catch(() => setAllSkills([]))
  }, [workspace?.path])

  // Poll messages for current session (catches updates when done arrives while on another task)
  const lastMsgCountRef = useRef(messages.length)
  useEffect(() => { lastMsgCountRef.current = messages.length }, [messages.length])
  useEffect(() => {
    if (!session?.id) return
    const timer = setInterval(async () => {
      try {
        const msgs = await window.electronAPI.getMessages(session.id)
        if (msgs.length !== lastMsgCountRef.current) {
          lastMsgCountRef.current = msgs.length
          setMessages(msgs)
        }
      } catch {}
      // Also poll canUndo status
      try {
        const r = await window.electronAPI.agentCanUndo(session.id)
        setCanUndo(r.canUndo)
      } catch {}
    }, 2000)
    return () => clearInterval(timer)
  }, [session?.id])

  // Load providers on mount and when settings change
  useEffect(() => {
    async function loadProviders() {
      const providersStr = await window.electronAPI.getSetting('llmProviders')
      if (providersStr) {
        try {
          setProviders(JSON.parse(providersStr))
        } catch {}
      }
    }
    loadProviders()
    const handler = () => loadProviders()
    window.addEventListener('settings-saved', handler)
    return () => window.removeEventListener('settings-saved', handler)
  }, [])

  // Global escape: close all dropdowns/overlays
  useEffect(() => {
    const handler = () => {
      setShowModeSelect(false)
      setShowStatusSelect(false)
      setShowDataSourcePanel(false)
      setShowAtPopup(false)
      setShowSkillPopup(false)
    }
    window.addEventListener('app:escape-pressed', handler)
    return () => window.removeEventListener('app:escape-pressed', handler)
  }, [])

  // Listen for Word text selection quotes
  useEffect(() => {
    const handler = (e: any) => {
      console.log('[ChatPanel] word:text-selected received', e.detail)
      const detail = e.detail as {
        filePath: string
        fileName: string
        selectedText: string
        paragraphs: TextQuote['paragraphs']
      }
      if (detail?.filePath && detail?.paragraphs) {
        setTextQuotes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fileName: detail.fileName,
            filePath: detail.filePath,
            preview: detail.selectedText.slice(0, 80) + (detail.selectedText.length > 80 ? '…' : ''),
            fullText: detail.selectedText,
            type: 'word',
            paragraphs: detail.paragraphs,
          },
        ])
      }
    }
    window.addEventListener('word:text-selected', handler)
    return () => window.removeEventListener('word:text-selected', handler)
  }, [])

  // Listen for editor (Monaco) text selection quotes
  useEffect(() => {
    const handler = (e: any) => {
      console.log('[ChatPanel] editor:text-selected received', e.detail)
      const detail = e.detail as {
        type: 'code' | 'markdown' | 'latex'
        filePath: string
        fileName: string
        selectedText: string
        range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
      }
      if (detail?.filePath && detail?.range) {
        setTextQuotes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fileName: detail.fileName,
            filePath: detail.filePath,
            preview: detail.selectedText.slice(0, 80) + (detail.selectedText.length > 80 ? '…' : ''),
            fullText: detail.selectedText,
            type: detail.type,
            paragraphs: [],
            range: detail.range,
          },
        ])
      }
    }
    window.addEventListener('editor:text-selected', handler)
    return () => window.removeEventListener('editor:text-selected', handler)
  }, [])

  // Auto-select model when providers change
  useEffect(() => {
    if (selectedModel) return
    const active = providers.find((p) => p.apiKey && p.models?.length > 0)
    if (active) setSelectedModel(active.defaultModel || active.models[0])
  }, [providers, selectedModel])

  // Auto-select model tier when workspace changes
  useEffect(() => {
    if (!workspace?.model_tier || providers.length === 0) return
    const tier = workspace.model_tier as 'fast' | 'balanced' | 'strong'
    const active = providers.find((p) => p.apiKey && p.models?.length > 0)
    if (!active) return
    const tierModel = tier === 'fast' ? active.modelFast : tier === 'balanced' ? active.modelBalanced : active.modelStrong
    const tierMapping: Record<string, 'weak' | 'medium' | 'strong'> = { fast: 'weak', balanced: 'medium', strong: 'strong' }
    if (tierModel && active.models?.includes(tierModel)) {
      setSelectedModel(tierModel)
      setSelectedTier(tierMapping[tier])
    }
  }, [workspace?.id, workspace?.model_tier, providers])

  // Auto-scroll: during active streaming
  useEffect(() => {
    if (isStreaming && streamingContent !== undefined) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isStreaming, streamingContent])

  // Scroll to bottom when switching sessions so user sees newest messages
  useEffect(() => {
    if (session?.id && messages.length > 0) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' })
      }, 0)
    }
  }, [session?.id])

  const handleAttach = async () => {
    const result = await window.electronAPI.openFile({
      multiple: true,
      filters: [
        {
          name: t('supportedFiles'),
          extensions: [
            'md',
            'txt',
            'py',
            'js',
            'ts',
            'json',
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
          ],
        },
        { name: t('imageFiles'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: t('allFiles'), extensions: ['*'] },
      ],
    })
    if (result.canceled || result.paths.length === 0) return
    for (const path of result.paths) {
      const ext = path.split('.').pop()?.toLowerCase() || ''
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
      if (isImage) {
        const res = await window.electronAPI.readFileBase64(path)
        if (!res.error) {
          const ext = path.split('.').pop()?.toLowerCase() || ''
          const mediaTypeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
          setAttachments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: window.electronAPI.pathBasename(path),
              type: 'image',
              content: res.data,
              mediaType: mediaTypeMap[ext] || 'image/png',
            },
          ])
        }
      } else {
        const res = await window.electronAPI.readFile(path)
        if (!res.error)
          setAttachments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: window.electronAPI.pathBasename(path),
              type: 'text',
              content: res.content,
            },
          ])
      }
    }
  }

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id))

  const removeQuote = (id: string) =>
    setTextQuotes((prev) => prev.filter((q) => q.id !== id))

  const sendMessage = async (overrideContent?: string) => {
    if (
      (!input.trim() && attachments.length === 0 && !overrideContent) ||
      !session?.id
    )
      return

    // If streaming, cancel current task first, then send new message
    if (isStreaming && session?.id) {
      await window.electronAPI.agentCancel(session.id)
      setSessionStreamingStates((prev) => {
        const s = prev[session.id]
        if (!s) return prev
        return { ...prev, [session.id]: { ...s, isStreaming: false, content: '', thinkContent: '', mode: null, toolCalls: [], error: null } }
      })
      setStreamingTaskId(null)
      setStreamingTaskIds((prev: Set<string>) => {
        const next = new Set(prev)
        next.delete(task?.id || '')
        return next
      })
      // Small delay to let the cancel propagate before sending new message
      await new Promise((r) => setTimeout(r, 100))
    }

    let userContent = overrideContent || input.trim()
    if (!overrideContent) {
      // Prepend text quotes
      if (textQuotes.length > 0) {
        const quoteBlocks = textQuotes.map((q) => {
          // Code / Markdown / LaTeX quote with line:column range
          if (q.type === 'code' || q.type === 'markdown' || q.type === 'latex') {
            const r = q.range!
            const locationInfo = r.startLine === r.endLine
              ? t('lineCol', { line: String(r.startLine), col: String(r.startColumn) }) + ` — ${t('lineCol', { line: String(r.startLine), col: String(r.endColumn) }).split('—')[1]}`
              : `${t('lineCol', { line: String(r.startLine), col: String(r.startColumn) })} — ${t('lineCol', { line: String(r.endLine), col: String(r.endColumn) })}`
            const modeHint = mode === 'explore'
              ? '当前处于探索模式，你只能提供建议，不能直接修改文件。'
              : mode === 'ask'
                ? '当前处于询问模式。你必须调用 writeFile/editFile/editFileRange 工具来提出修改方案。系统会自动暂停并展示修改内容供用户确认，用户同意后才会执行。不要直接在回复中输出修改后的文本。'
                : '当前处于执行模式，你可以直接调用工具修改文件。'
            return `[引用自 ${q.fileName} ${locationInfo}]\n用户选中的文本：\n"${q.fullText}"\n\n${modeHint}\n[/引用]`
          }

          // Word quote with paragraph indices
          const nonEmptyParas = q.paragraphs.filter((p) => p.text.trim() !== '')
          if (nonEmptyParas.length === 0) {
            return `[引用自 ${q.fileName}]\n（空引用）\n[/引用]`
          }
          const firstPara = nonEmptyParas[0]
          const lastPara = nonEmptyParas[nonEmptyParas.length - 1]
          const locationInfo = firstPara.index === lastPara.index
            ? `段落${firstPara.index + 1}${firstPara.style ? `（${firstPara.style}）` : ''}`
            : `段落${firstPara.index + 1} — 段落${lastPara.index + 1}`
          const modeHint = mode === 'explore'
            ? '当前处于探索模式，你只能提供建议，不能直接修改文件。'
            : mode === 'ask'
              ? '当前处于询问模式。你必须调用 writeFile/editFile/replaceWordParagraph 工具来提出修改方案。系统会自动暂停并展示修改内容供用户确认，用户同意后才会执行。不要直接在回复中输出修改后的文本。'
              : '当前处于执行模式，你可以直接调用工具修改文件。'
          return `[引用自 ${q.fileName}]\n用户选中的文本：\n"${q.fullText}"\n\n选区定位：${locationInfo}（段落编号从 1 开始，调用 replaceWordParagraph 时直接使用此编号）\n${modeHint}\n[/引用]`
        }).join('\n\n')
        userContent = `${quoteBlocks}\n\n${userContent}`
      }
      const imageAttachments = attachments.filter((a) => a.type === 'image')
      const textAttachments = attachments.filter((a) => a.type === 'text')
      for (const att of textAttachments)
        userContent = `[附件: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\`\n\n${userContent}`
      if (!userContent && imageAttachments.length > 0) userContent = '[图片]'
    }

    let config: any = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
      baseUrl: '',
    }
    const providersStr = await window.electronAPI.getSetting('llmProviders')
    if (providersStr) {
      try {
        const parsed = JSON.parse(providersStr)
        const active = parsed.find((p: any) => p.models?.includes(selectedModel))
        if (active)
          config = {
            provider: active.provider,
            model: selectedModel,
            apiKey: active.apiKey,
            baseUrl: active.baseUrl,
          }
        else {
          const fallback = parsed.find(
            (p: any) => p.apiKey && p.models?.length > 0,
          )
          if (fallback) {
            config = {
              provider: fallback.provider,
              model: fallback.defaultModel || fallback.models[0],
              apiKey: fallback.apiKey,
              baseUrl: fallback.baseUrl,
            }
            setSelectedModel(config.model)
          }
        }
      } catch {}
    }
    if (!config.apiKey) {
      const oldConfigStr = await window.electronAPI.getSetting('llmConfig')
      if (oldConfigStr) {
        try {
          config = JSON.parse(oldConfigStr)
        } catch {}
      }
    }
    if (!config.apiKey) {
      toast.error(t('configureAIConnection'))
      return
    }

    const saved = await window.electronAPI.createMessage(
      session.id,
      'user',
      userContent,
    )
    const newMessages = [...messages, saved]
    setMessages(newMessages)
    if (!overrideContent) {
      setInput('')
      setAttachments([])
      setTextQuotes([])
    }

    // ── Normal agent submit ──
    // Initialize per-session streaming state
    setSessionStreamingStates((prev) => ({
      ...prev,
      [session.id]: {
        isStreaming: true,
        content: '',
        thinkContent: '',
        mode,
        toolCalls: [],
        error: null,
      },
    }))
    if (task) {
      setStreamingTaskId(task.id)
      setStreamingTaskIds((prev: Set<string>) => new Set(prev).add(task.id))
      sessionToTaskRef.current.set(session.id, task.id)
    }
    activeSessionIdRef.current = session.id

    try {
      const imageAttachments = attachments.filter((a) => a.type === 'image')
      await window.electronAPI.agentSubmit({
        sessionId: session.id,
        userInput: userContent,
        config,
        mode,
        workspacePath: (() => {
          const basePath = workspace?.path || ''
          // Report directory detection: if current file is inside reportDir, switch workspacePath
          if (reportDir && currentFile) {
            const absCurrent = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(basePath, currentFile)
            const absReport = window.electronAPI.pathIsAbsolute(reportDir) ? reportDir : window.electronAPI.pathJoin(basePath, reportDir)
            if (absCurrent.startsWith(absReport)) {
              return reportDir
            }
          }
          return basePath
        })(),
        openFiles: (currentFile
          ? [...editorState.openFiles.filter((f) => f !== currentFile), currentFile]
          : editorState.openFiles
        ).map((f) => (window.electronAPI.pathIsAbsolute(f) ? f : window.electronAPI.pathJoin(workspace?.path || '', f))),
        tierOverride: selectedTier && selectedTier !== 'custom' ? selectedTier : undefined,
        modelOverride: selectedModel || undefined,
        attachments: imageAttachments.map((a) => ({
          type: 'image' as const,
          name: a.name,
          data: a.content,
          mediaType: a.mediaType || 'image/png',
        })),
        dataSources: selectedDataSources.kbFolderIds.length > 0 || selectedDataSources.apis.length > 0 || selectedDataSources.mcpServers.length > 0
          ? selectedDataSources
          : undefined,
      })
      // Persist mode + tier/model overrides to session
      if (session.id) {
        window.electronAPI.updateSessionMode(session.id, mode)
        if (selectedTier || selectedModel) {
          window.electronAPI.updateSessionOverrides?.(session.id, selectedTier, selectedModel)
        }
      }
    } catch (e: any) {
      toast.error(t('sendFailed') + ': ' + e.message)
      setSessionStreamingStates((prev) => ({
        ...prev,
        [session.id]: {
          ...(prev[session.id] || { content: '', thinkContent: '', mode: null, toolCalls: [] }),
          isStreaming: false,
          error: e.message,
        },
      }))
      setStreamingTaskId(null)
    }
  }

  const handleConfirmTool = async (toolCallId: string) => {
    if (!session?.id) return
    setSessionStreamingStates((prev) => {
      const s = prev[session.id]
      if (!s) return prev
      return {
        ...prev,
        [session.id]: {
          ...s,
          toolCalls: s.toolCalls.map((t) =>
            t.id === toolCallId ? { ...t, status: 'confirming' } : t,
          ),
        },
      }
    })
    await window.electronAPI.agentResolvePermission({
      sessionId: session.id,
      toolCallId,
      allow: true,
    })
  }

  const handleRejectTool = async (toolCallId: string) => {
    if (!session?.id) return
    const tc = toolCalls.find((t) => t.id === toolCallId)
    setSessionStreamingStates((prev) => {
      const s = prev[session.id]
      if (!s) return prev
      return {
        ...prev,
        [session.id]: {
          ...s,
          toolCalls: s.toolCalls.map((t) =>
            t.id === toolCallId ? { ...t, status: 'rejected' } : t,
          ),
          isStreaming: false,
        },
      }
    })
    await window.electronAPI.agentResolvePermission({
      sessionId: session.id,
      toolCallId,
      allow: false,
    })
    setStreamingTaskId(null)
    if (tc) toast.info(`${t('rejected')}: ${tc.name}`)
  }

  // Retry the last user message after an error
  const handleRetryLastMessage = async () => {
    if (!session?.id) return
    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) {
      toast.error(t('noRetryMessage'))
      return
    }
    // Clear error state
    setSessionStreamingStates((prev) => {
      const s = prev[session.id]
      if (!s) return prev
      return { ...prev, [session.id]: { ...s, error: null, isStreaming: true, content: '', thinkContent: '', toolCalls: [] } }
    })
    if (task) {
      setStreamingTaskId(task.id)
      setStreamingTaskIds((prev: Set<string>) => new Set(prev).add(task.id))
    }
    activeSessionIdRef.current = session.id

    let config: any = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
      baseUrl: '',
    }
    const providersStr = await window.electronAPI.getSetting('llmProviders')
    if (providersStr) {
      try {
        const parsed = JSON.parse(providersStr)
        const active = parsed.find((p: any) => p.models?.includes(selectedModel))
        if (active)
          config = { provider: active.provider, model: selectedModel, apiKey: active.apiKey, baseUrl: active.baseUrl }
        else {
          const fallback = parsed.find((p: any) => p.apiKey && p.models?.length > 0)
          if (fallback) {
            config = { provider: fallback.provider, model: fallback.defaultModel || fallback.models[0], apiKey: fallback.apiKey, baseUrl: fallback.baseUrl }
            setSelectedModel(config.model)
          }
        }
      } catch {}
    }
    if (!config.apiKey) {
      const oldConfigStr = await window.electronAPI.getSetting('llmConfig')
      if (oldConfigStr) {
        try { config = JSON.parse(oldConfigStr) } catch {}
      }
    }
    if (!config.apiKey) {
      toast.error(t('configureAIConnection'))
      setSessionStreamingStates((prev) => {
        const s = prev[session.id]
        if (!s) return prev
        return { ...prev, [session.id]: { ...s, isStreaming: false, error: t('aiConnectionNotConfigured') } }
      })
      return
    }

    try {
      await window.electronAPI.agentSubmit({
        sessionId: session.id,
        userInput: lastUserMsg.content,
        config,
        mode,
        workspacePath: (() => {
          const basePath = workspace?.path || ''
          if (reportDir && currentFile) {
            const absCurrent = window.electronAPI.pathIsAbsolute(currentFile) ? currentFile : window.electronAPI.pathJoin(basePath, currentFile)
            const absReport = window.electronAPI.pathIsAbsolute(reportDir) ? reportDir : window.electronAPI.pathJoin(basePath, reportDir)
            if (absCurrent.startsWith(absReport)) {
              return reportDir
            }
          }
          return basePath
        })(),
        openFiles: (currentFile
          ? [...editorState.openFiles.filter((f) => f !== currentFile), currentFile]
          : editorState.openFiles
        ).map((f) => (window.electronAPI.pathIsAbsolute(f) ? f : window.electronAPI.pathJoin(workspace?.path || '', f))),
        tierOverride: selectedTier && selectedTier !== 'custom' ? selectedTier : undefined,
        modelOverride: selectedModel || undefined,
        dataSources: selectedDataSources.kbFolderIds.length > 0 || selectedDataSources.apis.length > 0 || selectedDataSources.mcpServers.length > 0
          ? selectedDataSources
          : undefined,
      })
    } catch (e: any) {
      toast.error(t('retryFailed') + ': ' + e.message)
      setSessionStreamingStates((prev) => {
        const s = prev[session.id]
        if (!s) return prev
        return { ...prev, [session.id]: { ...s, isStreaming: false, error: e.message } }
      })
      setStreamingTaskId(null)
    }
  }

  // ── Agent Core IPC event listener (stable, never re-subscribed) ──
  // Updates per-session streaming state atom so background sessions keep streaming.
  useEffect(() => {
    const handleEvent = (eventSessionId: string, event: AgentEvent) => {
      // If this session was cleared, ignore ALL stale events including done/error
      if (!sessionStreamingStatesRef.current[eventSessionId]) return
      switch (event.type) {
        case 'text':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return { ...prev, [eventSessionId]: { ...s, content: s.content + event.text } }
          })
          break
        case 'reasoning':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return { ...prev, [eventSessionId]: { ...s, thinkContent: s.thinkContent + event.text } }
          })
          break
        case 'tool-use-start':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                toolCalls: [...s.toolCalls, { id: event.toolCallId, name: event.name, args: event.input, status: 'running' }],
              },
            }
          })
          break
        case 'tool-use-end':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                toolCalls: s.toolCalls.map((t) => {
                  if (t.id !== event.toolCallId) return t
                  if (t.status === 'rejected') return t
                  return { ...t, status: 'completed', result: event.result }
                }),
              },
            }
          })
          // Refresh file tree if a file-modifying tool completed
          if (['writeFile', 'editFile', 'executeCommand'].includes(event.name)) {
            const el = document.getElementById('file-tree-refresh-trigger')
            el?.click()
          }
          // Extract askUserQuestion for quick-reply UI
          if (event.name === 'askUserQuestion' && event.result) {
            let questions: Array<{ question: string; options?: string[] }> = []
            if (typeof event.result === 'object' && event.result !== null) {
              const r = event.result as any
              if (r.data && Array.isArray(r.data.questions)) {
                questions = r.data.questions
              } else if (r.data && r.data.question) {
                questions = [{ question: r.data.question, options: r.data.options }]
              }
            }
            if (questions.length > 0) {
              setQuestionQueue(questions.map(q => ({ ...q, source: 'agent' })))
              setQuestionAnswers([])
              setCurrentQIndex(0)
            }
          }
          break
        case 'permission-request':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            const exists = s.toolCalls.some((t) => t.id === event.toolCallId)
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                toolCalls: exists
                  ? s.toolCalls.map((t) =>
                      t.id === event.toolCallId
                        ? { ...t, status: 'needs-confirmation', result: { needsConfirmation: true, description: event.description } }
                        : t,
                    )
                  : [
                      ...s.toolCalls,
                      { id: event.toolCallId, name: event.name, args: {}, status: 'needs-confirmation', result: { needsConfirmation: true, description: event.description } },
                    ],
              },
            }
          })
          break
        case 'todo-update':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                todos: event.tasks,
                todoProgress: { completed: event.completedCount, total: event.totalCount },
              },
            }
          })
          break
        case 'done': {
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: { ...s, isStreaming: false, content: '', thinkContent: '', mode: null, toolCalls: [], todos: undefined, todoProgress: undefined, error: null },
            }
          })
          // Only clear streamingTaskId if the finishing session is the currently viewed one
          if (eventSessionId === sessionRef.current?.id) {
            setStreamingTaskId(null)
          }
          // Remove from global streaming set
          setStreamingTaskIds((prev: Set<string>) => {
            const next = new Set(prev)
            const taskId = sessionToTaskRef.current.get(eventSessionId)
            if (taskId) next.delete(taskId)
            return next
          })
          // Do NOT clear questionQueue here — askUserQuestion interrupts the loop
          // and done fires while questions are still pending. The queue is cleared
          // when the user finishes answering.
          // Refresh messages from DB — always update if current session matches,
          // otherwise the next loadSession effect or poll will pick it up.
          window.electronAPI.getMessages(eventSessionId).then((msgs) => {
            if (sessionRef.current?.id === eventSessionId) {
              setMessages(msgs)
            }
          })
          // Query canUndo after stream ends
          if (eventSessionId === sessionRef.current?.id) {
            window.electronAPI.agentCanUndo(eventSessionId).then((r) => setCanUndo(r.canUndo)).catch(() => {})
          }
          break
        }
        case 'model-switch':
          toast.info(`${t('modelSwitched')}: ${event.model}`)
          break
        case 'subagent-tool-start':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                toolCalls: [...s.toolCalls, {
                  id: `${event.parentToolCallId}:${event.toolCallId}`,
                  name: event.name,
                  args: event.input,
                  status: 'running',
                  isSubagent: true,
                }],
              },
            }
          })
          break
        case 'subagent-tool-end':
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return {
              ...prev,
              [eventSessionId]: {
                ...s,
                toolCalls: s.toolCalls.map((t) => {
                  if (t.id !== `${event.parentToolCallId}:${event.toolCallId}`) return t
                  if (t.status === 'rejected') return t
                  return { ...t, status: 'completed', result: event.result }
                }),
              },
            }
          })
          break
        case 'error':
          toast.error(`${t('aiError')}: ${event.message}`)
          setSessionStreamingStates((prev) => {
            const s = prev[eventSessionId]
            if (!s) return prev
            return { ...prev, [eventSessionId]: { ...s, isStreaming: false, error: event.message } }
          })
          // Only clear streamingTaskId if the erroring session is the currently viewed one
          if (eventSessionId === sessionRef.current?.id) {
            setStreamingTaskId(null)
          }
          // Remove from global streaming set
          setStreamingTaskIds((prev: Set<string>) => {
            const next = new Set(prev)
            const taskId = sessionToTaskRef.current.get(eventSessionId)
            if (taskId) next.delete(taskId)
            return next
          })
          // Do NOT clear questionQueue on error either — user may still need to answer.
          // Also refresh messages on error so any partial assistant/tool messages are visible
          window.electronAPI.getMessages(eventSessionId).then((msgs) => {
            if (sessionRef.current?.id === eventSessionId) {
              setMessages(msgs)
            }
          })
          // Query canUndo after stream ends
          if (eventSessionId === sessionRef.current?.id) {
            window.electronAPI.agentCanUndo(eventSessionId).then((r) => setCanUndo(r.canUndo)).catch(() => {})
          }
          break
      }
    }
    const unsubEvent = window.electronAPI.onAgentEvent(handleEvent)
    return () => { unsubEvent() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAtPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtSelectedIndex((i) => (i + 1) % Math.max(atResults.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtSelectedIndex((i) => (i - 1 + Math.max(atResults.length, 1)) % Math.max(atResults.length, 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (atResults.length > 0) {
          insertAtMention(atResults[atSelectedIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        setShowAtPopup(false)
        return
      }
    }
    if (showSkillPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSkillSelectedIndex((i) => (i + 1) % Math.max(skillResults.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSkillSelectedIndex((i) => (i - 1 + Math.max(skillResults.length, 1)) % Math.max(skillResults.length, 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (skillResults.length > 0) {
          insertSkillMention(skillResults[skillSelectedIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        setShowSkillPopup(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function insertAtMention(fileName: string) {
    if (!atMatchRef.current) return
    const { start, end } = atMatchRef.current
    const before = input.slice(0, start)
    const after = input.slice(end)
    const newInput = `${before}@${fileName} ${after}`
    setInput(newInput)
    setShowAtPopup(false)
    atMatchRef.current = null
    // Focus back to textarea after React renders
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function insertSkillMention(skill: { id: string; name: string }) {
    if (!skillMatchRef.current) return
    const { start, end } = skillMatchRef.current
    const before = input.slice(0, start)
    const after = input.slice(end)
    const newInput = `${before}/skill ${skill.id} ${after}`
    setInput(newInput)
    setShowSkillPopup(false)
    skillMatchRef.current = null
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function searchFilesForAt(query: string) {
    if (!workspace?.path) return []
    try {
      const result = await window.electronAPI.searchFiles(workspace.path, query)
      if (!result.error && result.results) {
        return result.results.slice(0, 8).map((r: any) => r.name || r.path || '')
      }
    } catch {}
    return []
  }

  const currentMode = modeConfig[mode]
  const activeProvider = providers.find(
    (p) => p.models?.includes(selectedModel) || p.defaultModel === selectedModel,
  )
  const availableModels = providers
    .filter((p) => p.apiKey && p.models?.length > 0)
    .flatMap((p) => p.models.map((m) => ({ name: m, provider: p.name })))

  // Change task status
  const changeTaskStatus = async (status: Task['status']) => {
    if (!task) return
    await window.electronAPI.updateTask(task.id, undefined, undefined, status)
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status } : t)),
    )
  }

  if (isCollapsed) {
    return (
      <div
        className="flex items-center justify-center cursor-pointer transition-colors"
        style={{
          width: 36,
          borderLeft: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
        onClick={onToggle}
        title={t('expandChatPanel')}
      >
        <PanelRightClose
          className="w-4 h-4"
          style={{ color: 'var(--na-text-tertiary)' }}
        />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full min-w-0 overflow-x-hidden"
      style={{ background: 'var(--na-bg-panel)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between shrink-0 px-4"
        style={{
          height: 48,
          borderBottom: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[13px] font-semibold truncate"
            style={{ color: 'var(--na-text-primary)' }}
          >
            {task?.title || t('noTaskSelected')}
          </span>
          {workspace && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-md"
              style={{
                background: 'var(--na-bg-active)',
                color: 'var(--na-text-tertiary)',
              }}
            >
              {workspace.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
            title={t('collapse')}
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        {messages.length === 0 && !isStreaming && !task && (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <div
              className="w-12 h-12 flex items-center justify-center rounded-2xl mb-4"
              style={{ background: 'var(--na-bg-active)' }}
            >
              <Sparkles
                className="w-6 h-6"
                style={{ color: 'var(--na-text-tertiary)' }}
              />
            </div>
            <p
              className="text-[14px] font-medium"
              style={{ color: 'var(--na-text-primary)' }}
            >
              {t('selectTaskToChat')}
            </p>
            <p className="text-[12px] mt-2" style={{ color: 'var(--na-text-tertiary)' }}>
              {t('aiAssistContext')}
            </p>
          </div>
        )}
        {messages.length === 0 && task && (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <div
              className="w-12 h-12 flex items-center justify-center rounded-2xl mb-4"
              style={{ background: currentMode.bg }}
            >
              <currentMode.icon
                className="w-6 h-6"
                style={{ color: currentMode.color }}
              />
            </div>
            <p
              className="text-[14px] font-medium"
              style={{ color: 'var(--na-text-primary)' }}
            >
              {t('newTaskChat')}「{task.title}」
            </p>
            <p className="text-[12px] mt-2" style={{ color: 'var(--na-text-tertiary)' }}>
              {t('currentMode')}
              <span style={{ color: currentMode.color }}>{currentMode.label}</span>{' '}
              —{' '}
              {mode === 'explore'
                ? ` ${t('exploreModeDesc')}`
                : mode === 'ask'
                  ? ` ${t('askModeDesc')}`
                  : ` ${t('executeModeDesc')}`}
            </p>
          </div>
        )}
        <div className="px-4 py-4 space-y-5">
          {mergeAssistantMessages(messages).map((msg: ChatMessage) => {
            const isUser = msg.role === 'user'
            const isTool = msg.role === 'tool'
            if (isTool) return null // Skip tool messages in UI (shown in assistant metadata)
            return (
              <div key={msg.id} className="group">
                {/* User message — right-aligned bubble */}
                {isUser && (
                  <div className="flex justify-end">
                    <div
                      className="max-w-[85%] px-4 py-2.5"
                      style={{
                        borderRadius:
                          'var(--na-radius-lg) var(--na-radius-lg) 4px var(--na-radius-lg)',
                        background: 'var(--na-user-bubble)',
                        color: 'var(--na-user-bubble-text)',
                      }}
                    >
                      <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
                        {(() => {
                          const segments = parseMessageWithQuotes(msg.content)
                          if (segments.length === 1 && segments[0].type === 'text') {
                            return segments[0].content
                          }
                          return segments.map((seg, i) =>
                            seg.type === 'text' ? (
                              <span key={i}>{seg.content}</span>
                            ) : (
                              <CollapsibleQuote
                                key={i}
                                fileName={seg.fileName}
                                fullText={seg.fullText}
                              />
                            )
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                {/* AI message — left-aligned full width */}
                {!isUser && (
                  <div className="flex gap-3">
                    <div
                      className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
                      style={{ background: 'var(--na-bg-active)' }}
                    >
                      <Sparkles
                        className="w-3.5 h-3.5"
                        style={{ color: 'var(--na-text-secondary)' }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[12px] font-medium mb-1"
                        style={{ color: 'var(--na-text-secondary)' }}
                      >
                        Note Agent
                      </div>
                      <AiMessageContent
                        content={msg.content}
                        toolCalls={msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined}
                        onApplyToDocx={textQuotes.length > 0 ? () => {
                          const quote = textQuotes[0]
                          if (!quote) return
                          // Extract plain text from AI reply (remove markdown code blocks)
                          let cleaned = msg.content
                            .replace(/```[\s\S]*?```/g, '')
                            .replace(/`([^`]+)`/g, '$1')
                            .trim()
                          // Try to find content after "修改后" or similar markers
                          const markers = ['修改后', '优化后', '替换为', '新版本', '修改结果']
                          for (const m of markers) {
                            const idx = cleaned.indexOf(m)
                            if (idx !== -1) {
                              const after = cleaned.slice(idx + m.length).trim()
                              if (after.length > 10) {
                                cleaned = after.replace(/^[：:]\s*/, '').trim()
                                break
                              }
                            }
                          }
                          const defaultText = cleaned.slice(0, 500)
                          const newText = window.prompt(
                            `${t('applyToParagraph')} ${quote.fileName} ${t('youCanEditBelow')}`,
                            defaultText,
                          )
                          if (!newText || !newText.trim()) return
                          const paraIdx = quote.paragraphs[0]?.index ?? 0
                          window.electronAPI.wordReplaceParagraph(quote.filePath, paraIdx, newText.trim())
                            .then((result) => {
                              if (result.success) {
                                toast.success(t('docUpdated'))
                                // Clear quotes after applying
                                setTextQuotes([])
                              } else {
                                toast.error(t('updateFailed') + ': ' + (result.error || t('unknownError')))
                              }
                            })
                            .catch((e: any) => {
                              toast.error(t('updateFailed') + ': ' + (e.message || t('unknownError')))
                            })
                        } : undefined}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Streaming response */}
          {(() => {
            // Show error card if there's a streaming error for current session
            if (streamingError && !isStreaming) {
              return (
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <AlertCircle className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="px-3 py-2.5" style={{ borderRadius: 'var(--na-radius-md)', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div className="text-[12px] font-medium mb-1" style={{ color: '#EF4444' }}>{t('aiResponseError')}</div>
                      <div className="text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>{streamingError}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={handleRetryLastMessage}
                          className="px-2.5 py-1 text-[11px] rounded font-medium transition-colors hover:opacity-90"
                          style={{ background: '#EF4444', color: '#fff' }}
                        >{t('retry')}</button>
                        <button
                          onClick={() => {
                            if (!session?.id) return
                            setSessionStreamingStates((prev) => {
                              const s = prev[session.id]
                              if (!s) return prev
                              return { ...prev, [session.id]: { ...s, error: null } }
                            })
                          }}
                          className="px-2.5 py-1 text-[11px] rounded font-medium transition-colors hover:bg-[var(--na-bg-hover)]"
                          style={{ color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)' }}
                        >{t('clear')}</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            // Show streaming UI based on current session's own streaming state
            // (background sessions stream into the atom but don't render here)
            if (!isStreaming && toolCalls.length === 0) return null
            return (
              <div className="flex gap-3">
                <div
                  className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
                  style={{ background: 'var(--na-bg-active)' }}
                >
                  <Sparkles
                    className="w-3.5 h-3.5"
                    style={{ color: 'var(--na-text-tertiary)' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <StreamingCard content={streamingContent} mode={streamingMode} thinkContent={thinkContent} isThinking={thinkContent.length > 0 && isStreaming} isStreaming={isStreaming} toolCalls={toolCalls} todos={streamingState?.todos} todoProgress={streamingState?.todoProgress} />
                  {/* Tool call action cards */}
                  {toolCalls.map((tc) => (
                    tc.status === 'needs-confirmation' && (
                      <div key={tc.id} className="mt-2 px-3 py-2.5" style={{ borderRadius: 'var(--na-radius-md)', background: 'var(--na-bg-active)', border: '1px solid var(--na-border-subtle)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                            <span className="text-[11px] truncate" style={{ color: 'var(--na-text-secondary)' }}>
                              {tc.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>{t('pendingConfirm')}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleConfirmTool(tc.id)}
                              className="px-2.5 py-1 text-[11px] rounded font-medium transition-colors hover:opacity-90"
                              style={{ background: 'var(--na-accent)', color: '#fff' }}
                            >{t('allow')}</button>
                            <button
                              onClick={() => handleRejectTool(tc.id)}
                              className="px-2.5 py-1 text-[11px] rounded font-medium transition-colors hover:bg-[var(--na-bg-hover)]"
                              style={{ color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)' }}
                            >{t('deny')}</button>
                          </div>
                        </div>
                        {/* Show the exact operation details */}
                        {tc.name === 'executeCommand' && tc.args?.command && (
                          <div className="mt-1.5 p-2 rounded text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[120px]" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                            <span style={{ color: 'var(--na-text-tertiary)' }}>$ </span>{tc.args.command}
                          </div>
                        )}
                        {tc.name === 'writeFile' && tc.args?.path && (
                          <div className="mt-1.5">
                            <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('writeFile')}: {tc.args.path}</div>
                            {tc.args?.content && (
                              <div className="mt-1 p-2 rounded text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[120px]" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>{String(tc.args.content).slice(0, 500)}{String(tc.args.content).length > 500 ? '...' : ''}</div>
                            )}
                          </div>
                        )}
                        {tc.name === 'editFile' && tc.args?.path && (
                          <div className="mt-1.5">
                            <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('editFile')}: {tc.args.path}</div>
                            {tc.args?.oldString && (
                              <div className="mt-1 p-2 rounded text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[80px]" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                                <div style={{ color: 'var(--na-text-tertiary)' }}>{t('deleteLines')}:</div>
                                {String(tc.args.oldString).slice(0, 300)}{String(tc.args.oldString).length > 300 ? '...' : ''}
                              </div>
                            )}
                            {tc.args?.newString && (
                              <div className="mt-1 p-2 rounded text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[80px]" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                                <div style={{ color: '#059669' }}>{t('replaceWith')}:</div>
                                {String(tc.args.newString).slice(0, 300)}{String(tc.args.newString).length > 300 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        )}
                        {tc.name === 'readFile' && tc.args?.path && (
                          <div className="mt-1.5 text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('readFile')}: {tc.args.path}</div>
                        )}
                        {tc.result?.description && (
                          <div className="mt-1.5 text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{tc.result.description}</div>
                        )}
                      </div>
                    )
                  ))}
                </div>
              </div>
          )
          })()}
          {/* Pending Question from askUserQuestion — shown inline in the chat stream */}
          {pendingQuestion && !isStreaming && (
            <div className="flex gap-3">
              <div
                className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
                style={{ background: 'var(--na-bg-active)' }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--na-text-secondary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--na-text-secondary)' }}>
                  Note Agent
                </div>
                <div className="px-3 py-2.5 rounded-lg" style={{ background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--na-accent-soft)', color: 'var(--na-accent)' }}>
                      {t('questionNum')} {currentQIndex + 1}/{questionQueue.length}
                    </span>
                    <div className="text-[13px]" style={{ color: 'var(--na-text-primary)' }}>
                      {pendingQuestion.question}
                    </div>
                  </div>
                  {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-2.5">
                      {pendingQuestion.options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => {
                            const nextIndex = currentQIndex + 1
                            const allAnswers = [...questionAnswers, opt]
                            if (nextIndex < questionQueue.length) {
                              setQuestionAnswers(allAnswers)
                              setCurrentQIndex(nextIndex)
                              setQuickReplyInput('')
                            } else {
                              const qaText = questionQueue.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${allAnswers[i]}`).join('\n\n')
                              setQuestionQueue([])
                              setQuestionAnswers([])
                              setCurrentQIndex(0)
                              setQuickReplyInput('')
                              sendMessage(qaText)
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors hover:opacity-90"
                          style={{ background: 'var(--na-accent)', color: '#fff' }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={quickReplyInput}
                      onChange={(e) => setQuickReplyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (!quickReplyInput.trim()) return
                          const answer = quickReplyInput.trim()
                          const nextIndex = currentQIndex + 1
                          const allAnswers = [...questionAnswers, answer]
                          if (nextIndex < questionQueue.length) {
                            setQuestionAnswers(allAnswers)
                            setCurrentQIndex(nextIndex)
                            setQuickReplyInput('')
                          } else {
                            const qaText = questionQueue.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${allAnswers[i]}`).join('\n\n')
                            setQuestionQueue([])
                            setQuestionAnswers([])
                            setCurrentQIndex(0)
                            setQuickReplyInput('')
                            sendMessage(qaText)
                          }
                        }
                      }}
                      placeholder={pendingQuestion.options && pendingQuestion.options.length > 0 ? t('orCustomAnswer') : t('enterAnswer')}
                      className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md outline-none"
                      style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)', border: '1px solid var(--na-border-subtle)' }}
                    />
                    <button
                      onClick={() => {
                        if (!quickReplyInput.trim()) return
                        const answer = quickReplyInput.trim()
                        const nextIndex = currentQIndex + 1
                        const allAnswers = [...questionAnswers, answer]
                        if (nextIndex < questionQueue.length) {
                          setQuestionAnswers(allAnswers)
                          setCurrentQIndex(nextIndex)
                          setQuickReplyInput('')
                        } else {
                          const qaText = questionQueue.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${allAnswers[i]}`).join('\n\n')
                          setQuestionQueue([])
                          setQuestionAnswers([])
                          setCurrentQIndex(0)
                          setQuickReplyInput('')
                          sendMessage(qaText)
                        }
                      }}
                      disabled={!quickReplyInput.trim()}
                      className="p-1.5 rounded-md transition-colors"
                      style={{
                        background: quickReplyInput.trim() ? 'var(--na-accent)' : 'var(--na-bg-active)',
                        color: quickReplyInput.trim() ? '#fff' : 'var(--na-text-tertiary)',
                      }}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Bottom Input Area */}
      <div
        className="shrink-0 px-4 pb-4 pt-2"
        style={{
          background: 'var(--na-bg-sidebar)',
          borderTop: '1px solid var(--na-border-subtle)',
        }}
      >
        {/* Top toolbar: Mode + Task Status */}
        <div className="flex items-center gap-2 mb-2">
          {/* Mode selector */}
          <div className="relative">
            <button
              onClick={() => setShowModeSelect(!showModeSelect)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors"
              style={{
                borderRadius: 'var(--na-radius-md)',
                background: currentMode.bg,
                color: currentMode.color,
              }}
            >
              <currentMode.icon className="w-3.5 h-3.5" />
              {currentMode.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showModeSelect && (
              <div
                className="absolute bottom-full left-0 mb-1 z-50 overflow-hidden na-popover-appear"
                style={{
                  width: 120,
                  borderRadius: 'var(--na-radius-lg)',
                  background: 'var(--na-bg-popover)',
                  boxShadow: 'var(--na-shadow-lg)',
                  border: '1px solid var(--na-border-subtle)',
                }}
              >
                {(['explore', 'ask', 'execute'] as const).map((m) => {
                  const cfg = modeConfig[m]
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m)
                        setShowModeSelect(false)
                        if (session?.id) {
                          window.electronAPI.updateSessionMode(session.id, m)
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                      style={{
                        background:
                          mode === m ? 'var(--na-bg-active)' : 'transparent',
                        color: 'var(--na-text-primary)',
                      }}
                    >
                      <cfg.icon
                        className="w-3.5 h-3.5"
                        style={{ color: cfg.color }}
                      />
                      <span className="text-[12px]">{cfg.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Task status selector */}
          {task && (
            <div className="relative">
              <button
                onClick={() => setShowStatusSelect(!showStatusSelect)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors"
                style={{
                  borderRadius: 'var(--na-radius-md)',
                  background: 'var(--na-bg-active)',
                  color: statusConfig[task.status].color,
                }}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: statusConfig[task.status].color }}
                />
                {statusConfig[task.status].label}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showStatusSelect && (
                <div
                  className="absolute bottom-full left-0 mb-1 z-50 overflow-hidden na-popover-appear"
                  style={{
                    width: 120,
                    borderRadius: 'var(--na-radius-lg)',
                    background: 'var(--na-bg-popover)',
                    boxShadow: 'var(--na-shadow-lg)',
                    border: '1px solid var(--na-border-subtle)',
                  }}
                >
                  {(
                    ['todo', 'in_progress', 'done', 'archived'] as const
                  ).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        changeTaskStatus(s)
                        setShowStatusSelect(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                      style={{
                        background:
                          task.status === s
                            ? 'var(--na-bg-active)'
                            : 'transparent',
                        color: 'var(--na-text-primary)',
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: statusConfig[s].color }}
                      />
                      <span className="text-[12px]">
                        {statusConfig[s].label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(showModeSelect || showStatusSelect || showDataSourcePanel) && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setShowModeSelect(false)
                setShowStatusSelect(false)
                setShowDataSourcePanel(false)
              }}
            />
          )}
        </div>

        {/* Big Modern Input Container */}
        <div
          className="flex flex-col"
          style={{
            borderRadius: 'var(--na-radius-xl)',
            border: '1px solid var(--na-border-default)',
            background: 'var(--na-bg-panel)',
            overflow: 'hidden',
          }}
        >
          {/* Text Quotes */}
          {textQuotes.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {textQuotes.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md"
                  style={{
                    background: 'rgba(139,92,246,0.12)',
                    color: '#7C3AED',
                    border: '1px solid rgba(139,92,246,0.2)',
                  }}
                  title={q.fullText}
                >
                  <Quote className="w-3 h-3" />
                  {q.fileName} · {q.preview}
                  <button
                    onClick={() => removeQuote(q.id)}
                    className="ml-0.5 p-0.5 rounded hover:bg-[rgba(139,92,246,0.2)]"
                    style={{ color: '#7C3AED' }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md"
                  style={{
                    background: 'var(--na-bg-active)',
                    color: 'var(--na-text-secondary)',
                    border: '1px solid var(--na-border-subtle)',
                  }}
                >
                  {att.type === 'image' ? '🖼' : '📄'} {att.name}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="ml-0.5 p-0.5 rounded hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-tertiary)' }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* @File mention popup — Portal + fixed to escape overflow clipping */}
          {showAtPopup && atResults.length > 0 && textareaRef.current &&
            createPortal(
              <div
                className="fixed z-[60] overflow-hidden"
                style={{
                  left: textareaRef.current.getBoundingClientRect().left + 16,
                  bottom: window.innerHeight - textareaRef.current.getBoundingClientRect().top + 4,
                  width: Math.max(textareaRef.current.getBoundingClientRect().width - 32, 240),
                  maxHeight: 200,
                  borderRadius: 'var(--na-radius-lg)',
                  background: 'var(--na-bg-popover)',
                  boxShadow: 'var(--na-shadow-lg)',
                  border: '1px solid var(--na-border-subtle)',
                }}
              >
                {atResults.map((file, idx) => (
                  <button
                    key={file}
                    onClick={() => insertAtMention(file)}
                    className="w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2"
                    style={{
                      background: idx === atSelectedIndex ? 'var(--na-bg-active)' : 'transparent',
                      color: 'var(--na-text-primary)',
                    }}
                  >
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-tertiary)' }}>
                      📄
                    </span>
                    <span className="truncate">{file}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}

          {/* Skill popup */}
          {showSkillPopup && skillResults.length > 0 && textareaRef.current &&
            createPortal(
              <div
                className="fixed z-[60] overflow-hidden"
                style={{
                  left: textareaRef.current.getBoundingClientRect().left + 16,
                  bottom: window.innerHeight - textareaRef.current.getBoundingClientRect().top + 4,
                  width: Math.max(textareaRef.current.getBoundingClientRect().width - 32, 240),
                  maxHeight: 200,
                  borderRadius: 'var(--na-radius-lg)',
                  background: 'var(--na-bg-popover)',
                  boxShadow: 'var(--na-shadow-lg)',
                  border: '1px solid var(--na-border-subtle)',
                }}
              >
                {skillResults.map((skill, idx) => (
                  <button
                    key={skill.id}
                    onClick={() => insertSkillMention(skill)}
                    className="w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2"
                    style={{
                      background: idx === skillSelectedIndex ? 'var(--na-bg-active)' : 'transparent',
                      color: 'var(--na-text-primary)',
                    }}
                  >
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-tertiary)' }}>
                      ⚡
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{skill.name}</div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--na-text-tertiary)' }}>/skill {skill.id}</div>
                    </div>
                  </button>
                ))}
              </div>,
              document.body
            )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const value = e.target.value
              setInput(value)

              const cursorPos = e.target.selectionStart
              const beforeCursor = value.slice(0, cursorPos)

              // Detect @ mention
              const atMatch = beforeCursor.match(/@([\w./-]*)$/)
              if (atMatch && workspace?.path) {
                const query = atMatch[1]
                setAtQuery(query)
                setAtSelectedIndex(0)
                atMatchRef.current = { start: cursorPos - atMatch[0].length, end: cursorPos }
                searchFilesForAt(query).then((results) => {
                  setAtResults(results.filter((r) => r))
                  setShowAtPopup(results.length > 0)
                })
                setShowSkillPopup(false)
                return
              }

              // Detect /skill command
              const skillMatch = beforeCursor.match(/\/([\w]*)$/)
              if (skillMatch && allSkills.length > 0) {
                const query = skillMatch[1].toLowerCase()
                const filtered = query
                  ? allSkills.filter((s) => s.id.toLowerCase().includes(query) || s.name.toLowerCase().includes(query))
                  : allSkills
                setSkillQuery(query)
                setSkillSelectedIndex(0)
                skillMatchRef.current = { start: cursorPos - skillMatch[0].length, end: cursorPos }
                setSkillResults(filtered.slice(0, 8))
                setShowSkillPopup(filtered.length > 0)
                setShowAtPopup(false)
                return
              }

              setShowAtPopup(false)
              setShowSkillPopup(false)
              atMatchRef.current = null
              skillMatchRef.current = null
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming && streamingTaskId === task?.id
                ? t('aiThinkingPlaceholder')
                : task
                  ? t('inputMessagePlaceholder')
                  : t('selectTaskToChat')
            }
            disabled={!task}
            className="w-full bg-transparent outline-none text-[14px] resize-none py-3 px-4"
            style={{
              color: 'var(--na-text-primary)',
              minHeight: 56,
              maxHeight: 160,
            }}
            rows={2}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 160)}px`
            }}
          />

          {/* Bottom toolbar inside container — no top border */}
          <div className="flex items-center justify-between px-3 pb-1 pt-0">
            <div className="flex items-center gap-1">
              <button
                onClick={handleAttach}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors hover:bg-[var(--na-bg-hover)]"
                style={{
                  borderRadius: 'var(--na-radius-md)',
                  color: 'var(--na-text-tertiary)',
                }}
              >
                <Paperclip className="w-3.5 h-3.5" />
                {t('attachments')}
              </button>
              {/* Data source selector */}
              <div className="relative">
                <button
                  ref={(el) => {
                    if (showDataSourcePanel && el) {
                      // Force re-render so portal can compute position
                      (dataSourceBtnRectRef as any).current = el.getBoundingClientRect()
                    }
                  }}
                  onClick={() => setShowDataSourcePanel(!showDataSourcePanel)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors hover:bg-[var(--na-bg-hover)]"
                  style={{
                    borderRadius: 'var(--na-radius-md)',
                    color: (selectedDataSources.kbFolderIds.length > 0 || selectedDataSources.apis.length > 0 || selectedDataSources.mcpServers.length > 0)
                      ? '#7C3AED'
                      : 'var(--na-text-tertiary)',
                    background: (selectedDataSources.kbFolderIds.length > 0 || selectedDataSources.apis.length > 0 || selectedDataSources.mcpServers.length > 0)
                      ? 'rgba(124,58,237,0.08)'
                      : 'transparent',
                  }}
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  {t('dataSources')}
                  <ChevronDown className="w-3 h-3" />
                  {(selectedDataSources.kbFolderIds.length + selectedDataSources.apis.length + selectedDataSources.mcpServers.length) > 0 && (
                    <span className="ml-0.5 text-[10px] font-medium">
                      {selectedDataSources.kbFolderIds.length + selectedDataSources.apis.length + selectedDataSources.mcpServers.length}
                    </span>
                  )}
                </button>
                {showDataSourcePanel && createPortal(
                  <div
                    className="fixed z-[60] overflow-hidden na-popover-appear"
                    style={{
                      left: (dataSourceBtnRectRef as any).current?.left ?? 0,
                      bottom: window.innerHeight - ((dataSourceBtnRectRef as any).current?.top ?? 0) + 4,
                      width: 240,
                      maxHeight: 320,
                      overflowY: 'auto',
                      borderRadius: 'var(--na-radius-lg)',
                      background: 'var(--na-bg-popover)',
                      border: '1px solid var(--na-border-subtle)',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                    }}
                  >
                    <div className="p-3 space-y-3">
                      {/* KB Folders */}
                      <div>
                        <h4 className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('kb')}</h4>
                        {kbFolders.length === 0 ? (
                          <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('none')}</div>
                        ) : (
                          <div className="space-y-1">
                            {kbFolders.map((folder) => (
                              <label key={folder.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedDataSources.kbFolderIds.includes(folder.id)}
                                  onChange={(e) => {
                                    setSelectedDataSources((prev) => ({
                                      ...prev,
                                      kbFolderIds: e.target.checked
                                        ? [...prev.kbFolderIds, folder.id]
                                        : prev.kbFolderIds.filter((id) => id !== folder.id),
                                    }))
                                  }}
                                  className="w-3.5 h-3.5 rounded"
                                />
                                <span className="text-[11px] truncate" style={{ color: 'var(--na-text-secondary)' }}>{folder.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* APIs */}
                      <div>
                        <h4 className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('thirdPartyServices')}</h4>
                        {userApis.length === 0 ? (
                          <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('none')}</div>
                        ) : (
                          <div className="space-y-1">
                            {userApis.map(({ key, label }) => (
                              <label key={key} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedDataSources.apis.includes(key)}
                                  onChange={(e) => {
                                    setSelectedDataSources((prev) => ({
                                      ...prev,
                                      apis: e.target.checked
                                        ? [...prev.apis, key]
                                        : prev.apis.filter((a) => a !== key),
                                    }))
                                  }}
                                  className="w-3.5 h-3.5 rounded"
                                />
                                <span className="text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>{label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* MCP Servers */}
                      <div>
                        <h4 className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('mcpServers')}</h4>
                        {mcpServers.length === 0 ? (
                          <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('none')}</div>
                        ) : (
                          <div className="space-y-1">
                            {mcpServers.map((server) => (
                              <label key={server.name} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedDataSources.mcpServers.includes(server.name)}
                                  onChange={(e) => {
                                    setSelectedDataSources((prev) => ({
                                      ...prev,
                                      mcpServers: e.target.checked
                                        ? [...prev.mcpServers, server.name]
                                        : prev.mcpServers.filter((s) => s !== server.name),
                                    }))
                                  }}
                                  className="w-3.5 h-3.5 rounded"
                                />
                                <span className="text-[11px] truncate" style={{ color: 'var(--na-text-secondary)' }}>{server.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Clear button */}
                      {(selectedDataSources.kbFolderIds.length > 0 || selectedDataSources.apis.length > 0 || selectedDataSources.mcpServers.length > 0) && (
                        <button
                          onClick={() => setSelectedDataSources({ kbFolderIds: [], apis: [], mcpServers: [] })}
                          className="w-full text-[11px] py-1 transition-colors hover:bg-[var(--na-bg-hover)]"
                          style={{ color: 'var(--na-text-tertiary)', borderRadius: 'var(--na-radius-md)' }}
                        >
                          {t('clearSelection')}
                        </button>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
              <button
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors"
                style={{
                  borderRadius: 'var(--na-radius-md)',
                  color: 'var(--na-text-tertiary)',
                  cursor: 'default',
                }}
              >
                <Folder className="w-3.5 h-3.5" />
                {workspace?.name || t('noWorkspaceSelected')}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Model Selector */}
              <div className="relative">
                {providers.length === 0 ? (
                  <button
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('open-settings', {
                          detail: 'connection',
                        }),
                      )
                    }
                    className="flex items-center gap-1 px-2 py-1 text-[11px] transition-colors"
                    style={{
                      borderRadius: 'var(--na-radius-md)',
                      color: 'var(--na-status-execute)',
                      background: 'rgba(217,119,6,0.08)',
                    }}
                  >
                    <Plus className="w-3 h-3" /> {t('addConnection')}
                  </button>
                ) : availableModels.length === 0 ? (
                  <button
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('open-settings', {
                          detail: 'connection',
                        }),
                      )
                    }
                    className="flex items-center gap-1 px-2 py-1 text-[11px] transition-colors"
                    style={{
                      borderRadius: 'var(--na-radius-md)',
                      color: 'var(--na-status-execute)',
                      background: 'rgba(217,119,6,0.08)',
                    }}
                  >
                    <Sparkles className="w-3 h-3" /> {t('configureConnection')}
                  </button>
                ) : (
                  <ModelSelector
                    selectedModel={selectedModel}
                    selectedTier={selectedTier}
                    onSelect={({ model, tier }) => {
                      setSelectedModel(model)
                      setSelectedTier(tier || 'custom')
                    }}
                  >
                    <button
                      className="flex items-center gap-1 px-2 py-1 text-[11px] transition-colors hover:bg-[var(--na-bg-hover)]"
                      style={{
                        borderRadius: 'var(--na-radius-md)',
                        color: 'var(--na-text-tertiary)',
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {selectedModel || t('selectModel')}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </ModelSelector>
                )}
              </div>

              {isStreaming ? (
                <button
                  onClick={async () => {
                    if (!session?.id) return
                    await window.electronAPI.agentCancel(session.id)
                    setSessionStreamingStates((prev) => {
                      const s = prev[session.id]
                      if (!s) return prev
                      return { ...prev, [session.id]: { ...s, isStreaming: false, content: '', thinkContent: '', mode: null, toolCalls: [], error: null } }
                    })
                    setStreamingTaskId(null)
                    setStreamingTaskIds((prev: Set<string>) => {
                      const next = new Set(prev)
                      const taskId = sessionToTaskRef.current.get(session.id)
                      if (taskId) next.delete(taskId)
                      return next
                    })
                    sessionToTaskRef.current.delete(session.id)
                  }}
                  className="p-2 rounded-lg shrink-0 transition-all"
                  style={{
                    borderRadius: 'var(--na-radius-md)',
                    background: 'var(--na-accent)',
                    color: '#fff',
                  }}
                  title={t('stopGeneration')}
                >
                  <Square className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={(!input.trim() && attachments.length === 0) || !task}
                  className="p-2 rounded-lg shrink-0 transition-all"
                  style={{
                    borderRadius: 'var(--na-radius-md)',
                    background:
                      (input.trim() || attachments.length > 0) && task
                        ? 'var(--na-accent)'
                        : 'transparent',
                    color:
                      (input.trim() || attachments.length > 0) && task
                        ? '#fff'
                        : 'var(--na-text-tertiary)',
                    opacity:
                      (input.trim() || attachments.length > 0) && task
                        ? 1
                        : 0.4,
                  }}
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
              {/* Undo last submit changes */}
              {session?.id && messages.length > 0 && !isStreaming && (
                <button
                  onClick={async () => {
                    if (!canUndo) return
                    if (!confirm(t('confirmUndo'))) return
                    try {
                      const result = await window.electronAPI.agentUndoAll(session.id)
                      if (result.success) {
                        setCanUndo(false)
                        toast.success(t('undoneFiles', { count: String(result.restored) }))
                        // Refresh file content in editor
                        window.dispatchEvent(new CustomEvent('file:refresh-all'))
                      } else {
                        toast.error(result.error || t('undoFailed'))
                      }
                    } catch (e: any) {
                      toast.error(t('undoFailed') + ': ' + e.message)
                    }
                  }}
                  disabled={!canUndo}
                  className="p-2 rounded-lg shrink-0 transition-all"
                  style={{
                    borderRadius: 'var(--na-radius-md)',
                    color: canUndo ? 'var(--na-text-tertiary)' : 'var(--na-text-disabled)',
                    opacity: canUndo ? 1 : 0.4,
                    cursor: canUndo ? 'pointer' : 'not-allowed',
                  }}
                  title={canUndo ? t('undoLastChange') : t('noUndoAvailable')}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>


    </div>
  )
}
