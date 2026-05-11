import { useState, useEffect, useRef, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { currentSessionAtom, currentWorkspaceAtom } from '../atoms'
import {
  GripVertical,
  BarChart3,
  ListTodo,
  Wrench,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  Minimize2,
  RotateCcw,
  Trash2,
} from 'lucide-react'

type Tab = 'cost' | 'todo' | 'skills'

interface TodoItem {
  text: string
  completed: boolean
  createdAt: string
}

interface ProviderStat {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  callCount: number
}

interface CostReport {
  stats: ProviderStat[]
  total: { input: number; output: number }
}

interface ProviderGroup {
  provider: string
  models: ProviderStat[]
  totalInput: number
  totalOutput: number
  totalCalls: number
}

interface SkillInfo {
  id: string
  name: string
  description: string
  alwaysInject: boolean
}

export default function FloatingPanel() {
  const session = useAtomValue(currentSessionAtom)
  const workspace = useAtomValue(currentWorkspaceAtom)
  const [collapsed, setCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('cost')
  const [panelY, setPanelY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const panelStartY = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const [costReport, setCostReport] = useState<CostReport | null>(null)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])

  // Poll for data
  useEffect(() => {
    if (collapsed) return
    const interval = setInterval(async () => {
      if (session?.id) {
        try {
          const report = await window.electronAPI.agentGetCostReport(session.id)
          setCostReport(report)
        } catch {}
        try {
          const list = await window.electronAPI.agentGetTodoList(session.id)
          setTodos(Array.isArray(list) ? list : [])
        } catch {
          setTodos([])
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [collapsed, session?.id])

  // Also load immediately when expanding
  useEffect(() => {
    if (collapsed || !session?.id) return
    ;(async () => {
      try {
        const report = await window.electronAPI.agentGetCostReport(session.id)
        setCostReport(report)
      } catch {}
      try {
        const list = await window.electronAPI.agentGetTodoList(session.id)
        setTodos(Array.isArray(list) ? list : [])
      } catch {
        setTodos([])
      }
    })()
  }, [collapsed, session?.id])

  // Load skills when workspace changes or tab switched to skills
  useEffect(() => {
    if (collapsed || activeTab !== 'skills') return
    if (!workspace?.path) { setSkills([]); return }
    ;(async () => {
      try {
        const list = await window.electronAPI.listSkills(workspace.path)
        setSkills(Array.isArray(list) ? list : [])
      } catch {
        setSkills([])
      }
    })()
  }, [collapsed, activeTab, workspace?.path])

  // Vertical drag handlers for the trigger button
  const onTriggerMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartY.current = e.clientY
    panelStartY.current = panelY
    setIsDragging(true)
    e.preventDefault()
  }, [panelY])

  // Vertical drag handlers for the panel header
  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartY.current = e.clientY
    panelStartY.current = panelY
    setIsDragging(true)
    e.preventDefault()
  }, [panelY])

  useEffect(() => {
    if (!isDragging) return
    const onMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartY.current
      setPanelY(panelStartY.current + deltaY)
    }
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging])

  // Compute vertical position (centered on screen + offset)
  const triggerTop = typeof window !== 'undefined'
    ? Math.max(80, Math.min(window.innerHeight - 120, window.innerHeight / 2 - 60 + panelY))
    : 200

  const panelTop = typeof window !== 'undefined'
    ? Math.max(40, Math.min(window.innerHeight - 360, window.innerHeight / 2 - 160 + panelY))
    : 100

  const tabs: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'cost', label: '用量', icon: BarChart3 },
    { key: 'todo', label: '待办', icon: ListTodo },
    { key: 'skills', label: '技能', icon: Wrench },
  ]

  // Format tokens in k (1 decimal) for readability
  const fmt = (n: number) => n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`

  // Clean provider names (now using config names; fallback for legacy records)
  const cleanProvider = (p: string) => {
    if (!p || p === 'unknown') return '未知'
    return p
  }

  const providerGroups: ProviderGroup[] = (() => {
    if (!costReport?.stats.length) return []
    const map = new Map<string, ProviderStat[]>()
    for (const stat of costReport.stats) {
      const list = map.get(stat.provider) || []
      list.push(stat)
      map.set(stat.provider, list)
    }
    return Array.from(map.entries()).map(([provider, models]) => ({
      provider,
      models,
      totalInput: models.reduce((s, m) => s + m.inputTokens, 0),
      totalOutput: models.reduce((s, m) => s + m.outputTokens, 0),
      totalCalls: models.reduce((s, m) => s + m.callCount, 0),
    })).sort((a, b) => (b.totalInput + b.totalOutput) - (a.totalInput + a.totalOutput))
  })()

  if (collapsed) {
    return (
      <div
        className="fixed z-50 flex flex-col items-center"
        style={{ right: 0, top: triggerTop }}
      >
        <button
          onClick={() => setCollapsed(false)}
          onMouseDown={onTriggerMouseDown}
          className="flex items-center justify-center rounded-l-lg shadow-lg transition-all hover:opacity-90"
          style={{
            width: 28,
            height: 80,
            background: 'var(--na-accent)',
            color: '#fff',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          title="状态面板"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const completedCount = todos.filter((t) => t.completed).length

  return (
    <div
      ref={panelRef}
      className="fixed z-50 flex flex-col overflow-hidden"
      style={{
        right: 0,
        top: panelTop,
        width: 260,
        height: 340,
        borderRadius: 'var(--na-radius-lg) 0 0 var(--na-radius-lg)',
        background: 'var(--na-bg-popover)',
        boxShadow: 'var(--na-shadow-lg)',
        border: '1px solid var(--na-border-subtle)',
        borderRight: 'none',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 select-none"
        style={{ borderBottom: '1px solid var(--na-border-subtle)', cursor: 'grab' }}
        onMouseDown={onPanelMouseDown}
      >
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
              style={{
                background: activeTab === t.key ? 'var(--na-bg-active)' : 'transparent',
                color: activeTab === t.key ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)',
              }}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {activeTab === 'cost' && (
            <button
              onClick={async () => {
                if (!confirm('确定要清空所有用量记录吗？')) return
                try {
                  await window.electronAPI.agentClearCost()
                  setCostReport(null)
                } catch {}
              }}
              className="p-1 rounded hover:bg-[var(--na-bg-hover)]"
              style={{ color: 'var(--na-text-tertiary)' }}
              title="清空用量记录"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setCollapsed(true)} className="p-1 rounded hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
            <Minimize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'cost' && (
          <div className="space-y-2">
            {costReport && costReport.stats.length > 0 ? (
              <>
                {/* Total */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-md text-center" style={{ background: 'var(--na-bg-active)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>Input</div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{fmt(costReport.total?.input ?? 0)}</div>
                  </div>
                  <div className="p-2 rounded-md text-center" style={{ background: 'var(--na-bg-active)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>Output</div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{fmt(costReport.total?.output ?? 0)}</div>
                  </div>
                </div>
                {/* Provider groups (collapsible) */}
                <div className="space-y-1">
                  {providerGroups.map((group) => (
                    <div key={group.provider} className="rounded-md overflow-hidden" style={{ background: 'var(--na-bg-active)' }}>
                      <button
                        onClick={() => toggleProvider(group.provider)}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-[11px]"
                      >
                        <div className="flex items-center gap-1.5">
                          {expandedProviders.has(group.provider) ? (
                            <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                          ) : (
                            <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                          )}
                          <span className="font-medium" style={{ color: 'var(--na-text-primary)' }}>{cleanProvider(group.provider)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>
                          <span>In {fmt(group.totalInput)}</span>
                          <span>Out {fmt(group.totalOutput)}</span>
                        </div>
                      </button>
                      {expandedProviders.has(group.provider) && (
                        <div className="px-2.5 pb-2 space-y-1">
                          {group.models.map((stat, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px] py-1 px-2 rounded" style={{ background: 'var(--na-bg-panel)' }}>
                              <span className="truncate max-w-[100px]" style={{ color: 'var(--na-text-secondary)' }}>{stat.model}</span>
                              <div className="flex items-center gap-2 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>
                                <span>In {fmt(stat.inputTokens)}</span>
                                <span>Out {fmt(stat.outputTokens)}</span>
                                <span>×{stat.callCount}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
                暂无使用记录
              </div>
            )}
          </div>
        )}

        {activeTab === 'todo' && (
          <div className="space-y-1">
            {!session && (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
                选择一个任务查看待办列表
              </div>
            )}
            {session && todos.length === 0 && (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
                暂无待办事项
              </div>
            )}
            {session && todos.length > 0 && (
              <>
                <div className="flex items-center justify-between text-[10px] px-1 mb-1" style={{ color: 'var(--na-text-tertiary)' }}>
                  <span>进度 {completedCount}/{todos.length}</span>
                  <span>{Math.round((completedCount / todos.length) * 100)}%</span>
                </div>
                {todos.map((todo, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md text-[11px]"
                    style={{ background: 'var(--na-bg-active)' }}
                  >
                    {todo.completed ? (
                      <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--na-accent)' }} />
                    ) : (
                      <Circle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--na-text-tertiary)' }} />
                    )}
                    <span
                      className="flex-1 leading-relaxed"
                      style={{
                        color: todo.completed ? 'var(--na-text-tertiary)' : 'var(--na-text-primary)',
                        textDecoration: todo.completed ? 'line-through' : 'none',
                      }}
                    >
                      {todo.text}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="space-y-2">
            {!workspace?.path && (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
                选择一个工作区查看技能列表
              </div>
            )}
            {workspace?.path && skills.length === 0 && (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>
                暂无自定义技能
                <div className="text-[10px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>
                  在 ~/.note_agent/skills/ 或项目 .note_agent/skills/ 下创建 skill.md
                </div>
              </div>
            )}
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="px-2.5 py-2 rounded-md text-[11px]"
                style={{ background: 'var(--na-bg-active)' }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-medium" style={{ color: 'var(--na-text-primary)' }}>{skill.name}</span>
                  {skill.alwaysInject && (
                    <span className="text-[9px] px-1 rounded" style={{ background: 'var(--na-accent)', color: '#fff' }}>常驻</span>
                  )}
                </div>
                <div className="text-[10px] leading-relaxed" style={{ color: 'var(--na-text-secondary)' }}>
                  {skill.description || skill.id}
                </div>
                <div className="text-[9px] mt-1 font-mono" style={{ color: 'var(--na-text-tertiary)' }}>
                  /skill {skill.id}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
