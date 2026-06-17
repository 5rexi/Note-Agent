import { useEffect, useRef, useState } from 'react'
import { Coins, ChevronDown, Trash2 } from 'lucide-react'

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

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
}

/**
 * Header chip showing session token usage. Click to open a detail popover with
 * a per-provider / per-model breakdown (replaces the old floating panel's Cost
 * tab — on-demand, never covering the conversation).
 */
export function CostMeter({ sessionId, isStreaming }: { sessionId?: string; isStreaming: boolean }) {
  const [report, setReport] = useState<CostReport | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const r = await window.electronAPI.agentGetCostReport(sessionId || '')
        if (alive) setReport(r ?? null)
      } catch { /* ignore */ }
    }
    refresh()
    // Poll while streaming, or while the popover is open.
    const id = (isStreaming || open) ? window.setInterval(refresh, 2000) : undefined
    return () => { alive = false; if (id) window.clearInterval(id) }
  }, [sessionId, isStreaming, open])

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [open])

  const total = report?.total
  if (!total || (total.input === 0 && total.output === 0)) return null
  const sum = total.input + total.output

  const groups: ProviderGroup[] = (() => {
    if (!report?.stats?.length) return []
    const map = new Map<string, ProviderStat[]>()
    for (const s of report.stats) {
      const list = map.get(s.provider) || []
      list.push(s); map.set(s.provider, list)
    }
    return Array.from(map.entries()).map(([provider, models]) => ({
      provider, models,
      totalInput: models.reduce((a, m) => a + m.inputTokens, 0),
      totalOutput: models.reduce((a, m) => a + m.outputTokens, 0),
    })).sort((a, b) => (b.totalInput + b.totalOutput) - (a.totalInput + a.totalOutput))
  })()

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors hover:bg-[var(--na-bg-hover)]"
        style={{ color: 'var(--na-text-secondary)', background: open ? 'var(--na-bg-hover)' : 'var(--na-bg-active)' }}
        title="Token 用量明细"
      >
        <Coins className="w-3 h-3" />
        {fmt(sum)} tok
        <ChevronDown className="w-3 h-3" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 z-50 na-popover-appear"
          style={{
            width: 264, maxHeight: 360, overflow: 'auto',
            background: 'var(--na-bg-popover)', border: '1px solid var(--na-border-subtle)',
            borderRadius: 'var(--na-radius-lg)', boxShadow: 'var(--na-shadow-lg)', padding: 10,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--na-text-secondary)' }}>Token 用量</span>
            <button
              onClick={async () => {
                if (!confirm('确定要清空所有用量记录吗？')) return
                try { await window.electronAPI.agentClearCost(); setReport(null); setOpen(false) } catch { /* ignore */ }
              }}
              className="p-1 rounded hover:bg-[var(--na-bg-hover)]"
              style={{ color: 'var(--na-text-tertiary)' }}
              title="清空用量记录"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="p-2 rounded-md text-center" style={{ background: 'var(--na-bg-active)' }}>
              <div className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>Input</div>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{fmt(total.input)}</div>
            </div>
            <div className="p-2 rounded-md text-center" style={{ background: 'var(--na-bg-active)' }}>
              <div className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>Output</div>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{fmt(total.output)}</div>
            </div>
          </div>

          <div className="space-y-1">
            {groups.map((g) => (
              <div key={g.provider} className="rounded-md px-2.5 py-2" style={{ background: 'var(--na-bg-active)' }}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium truncate" style={{ color: 'var(--na-text-primary)' }}>{g.provider || '未知'}</span>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>In {fmt(g.totalInput)} · Out {fmt(g.totalOutput)}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {g.models.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5 px-2 rounded" style={{ background: 'var(--na-bg-panel)' }}>
                      <span className="truncate max-w-[110px]" style={{ color: 'var(--na-text-secondary)' }}>{m.model}</span>
                      <span className="shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>In {fmt(m.inputTokens)} · Out {fmt(m.outputTokens)} · ×{m.callCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
