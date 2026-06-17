import { useEffect, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'

interface Hit { session_id: string; role: string; content: string; created_at: number; title?: string }
interface Summary { id: string; title: string; summary: string | null; created_at: number }

const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString()
const stripBlobs = (s: string) => s.replace(/"data"\s*:\s*"[A-Za-z0-9+/=]{40,}"/g, '"data":"[image]"')
const snippet = (s: string, n = 220) => { const c = stripBlobs(s); return c.length > n ? c.slice(0, n) + '…' : c }

/**
 * In-panel conversation search overlay. Searches the persisted transcript via
 * the `recall:search` IPC (current session + workspace). Closes on ✕/Esc/backdrop.
 */
export function ConversationSearch({
  sessionId,
  workspacePath,
  onClose,
}: {
  sessionId?: string
  workspacePath?: string
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); setSummaries([]); return }
    let alive = true
    setLoading(true)
    const id = window.setTimeout(async () => {
      try {
        const r = await window.electronAPI.recallSearch({ query: q, sessionId, workspacePath, limit: 40 })
        if (!alive) return
        setHits(r?.hits ?? [])
        setSummaries(r?.summaries ?? [])
      } catch { if (alive) { setHits([]); setSummaries([]) } }
      finally { if (alive) setLoading(false) }
    }, 200)
    return () => { alive = false; window.clearTimeout(id) }
  }, [query, sessionId, workspacePath])

  return (
    <div className="absolute inset-0 z-30 flex" style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(2px)' }} onClick={onClose}>
      <div
        className="absolute inset-3 flex flex-col rounded-xl overflow-hidden na-popout-in"
        style={{ background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)', border: '1px solid var(--na-border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this and past conversations…"
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--na-text-primary)' }}
          />
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {!query.trim() && (
            <div className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>Type to search message history.</div>
          )}
          {query.trim() && !loading && hits.length === 0 && summaries.length === 0 && (
            <div className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>No matches for “{query}”.</div>
          )}

          {summaries.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>Conversations</div>
              <div className="space-y-1">
                {summaries.slice(0, 12).map((s) => (
                  <div key={s.id} className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    <span style={{ color: 'var(--na-text-secondary)' }}>{s.title}</span> — {snippet(s.summary || '', 120)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hits.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>Messages</div>
              <div className="space-y-2">
                {hits.map((h, i) => (
                  <div key={i} className="rounded-md px-3 py-2" style={{ background: 'var(--na-bg-active)' }}>
                    <div className="text-[10px] mb-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
                      {h.title ? `${h.title} · ` : ''}{h.role} · {fmtDate(h.created_at)}
                    </div>
                    <div className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--na-text-secondary)' }}>{snippet(h.content)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
