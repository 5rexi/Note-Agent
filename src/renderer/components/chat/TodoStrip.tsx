import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface TodoItem { text: string; completed: boolean }

const GREEN = '#059669'        // done
const ACCENT = 'var(--na-primary)' // current (in-progress)
const GREY = 'var(--na-border-default)' // pending

/**
 * Compact todo strip under the chat title. Collapsed = a row of dots (green =
 * done, indigo = the current task, grey = pending) + a done/total count. Click
 * to expand into the full checklist. Renders nothing when there are no todos.
 */
export function TodoStrip({ sessionId, isStreaming }: { sessionId?: string; isStreaming: boolean }) {
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!sessionId) { setTodos([]); return }
    let alive = true
    const refresh = async () => {
      try {
        const list = await window.electronAPI.agentGetTodoList(sessionId)
        if (alive) setTodos(Array.isArray(list) ? list : [])
      } catch { if (alive) setTodos([]) }
    }
    refresh()
    const id = window.setInterval(refresh, isStreaming ? 1500 : 4000)
    return () => { alive = false; window.clearInterval(id) }
  }, [sessionId, isStreaming])

  if (todos.length === 0) return null

  const done = todos.filter((t) => t.completed).length
  const currentIdx = todos.findIndex((t) => !t.completed) // first incomplete = "now doing"
  const colorFor = (i: number, t: TodoItem) => (t.completed ? GREEN : i === currentIdx ? ACCENT : GREY)

  return (
    <div
      className="shrink-0"
      style={{ borderBottom: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-sidebar)' }}
    >
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 transition-colors hover:bg-[var(--na-bg-hover)]"
      >
        <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--na-text-secondary)' }}>待办</span>
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {todos.map((t, i) => (
            <span
              key={i}
              className="shrink-0 rounded-full"
              style={{
                width: i === currentIdx && !t.completed ? 8 : 6,
                height: i === currentIdx && !t.completed ? 8 : 6,
                background: colorFor(i, t),
                boxShadow: i === currentIdx && !t.completed ? `0 0 0 2px color-mix(in srgb, ${ACCENT} 25%, transparent)` : undefined,
              }}
            />
          ))}
        </div>
        <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>{done}/{todos.length}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {/* Expanded checklist */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1 overflow-auto" style={{ maxHeight: 220 }}>
          {todos.map((t, i) => {
            const current = i === currentIdx && !t.completed
            return (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-md text-[11px]" style={{ background: 'var(--na-bg-active)' }}>
                <span className="shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 14, height: 14 }}>
                  {t.completed ? (
                    <Check className="w-3.5 h-3.5" style={{ color: GREEN }} />
                  ) : (
                    <span className="rounded-full" style={{ width: current ? 9 : 7, height: current ? 9 : 7, background: current ? ACCENT : GREY }} />
                  )}
                </span>
                <span
                  className="flex-1 leading-relaxed"
                  style={{
                    color: t.completed ? 'var(--na-text-tertiary)' : current ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                    textDecoration: t.completed ? 'line-through' : 'none',
                    fontWeight: current ? 600 : 400,
                  }}
                >
                  {t.text}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
