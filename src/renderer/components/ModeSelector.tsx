import { useState, useRef, useEffect } from 'react'
import { Zap, Sparkles, Terminal, FlaskConical, Check } from 'lucide-react'

interface ModeSelectorProps {
  mode: 'explore' | 'ask' | 'execute' | 'research'
  onChange: (mode: 'explore' | 'ask' | 'execute' | 'research') => void
}

const modes: Array<{
  id: 'explore' | 'ask' | 'execute' | 'research'
  label: string
  description: string
  icon: typeof Sparkles
  color: string
  softColor: string
}> = [
  {
    id: 'explore',
    label: '探索',
    description: 'AI 帮你理解代码',
    icon: Sparkles,
    color: '#2563EB',
    softColor: 'rgba(37,99,235,0.08)',
  },
  {
    id: 'ask',
    label: '询问',
    description: '向 AI 提问',
    icon: Zap,
    color: '#059669',
    softColor: 'rgba(5,150,105,0.08)',
  },
  {
    id: 'execute',
    label: '执行',
    description: 'AI 执行代码更改',
    icon: Terminal,
    color: '#D97706',
    softColor: 'rgba(217,119,6,0.08)',
  },
  {
    id: 'research',
    label: '研究',
    description: 'AI 深度研究并生成报告',
    icon: FlaskConical,
    color: '#7C3AED',
    softColor: 'rgba(124,58,237,0.08)',
  },
]

export default function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = modes.find((m) => m.id === mode)
  if (!current) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium transition-colors"
        style={{
          borderRadius: 'var(--na-radius-md)',
          color: current.color,
          background: current.softColor,
        }}
      >
        <current.icon className="w-3 h-3" />
        {current.label}
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 overflow-hidden na-popover-appear z-50"
          style={{
            width: 200,
            borderRadius: 'var(--na-radius-lg)',
            background: 'var(--na-bg-popover)',
            boxShadow: 'var(--na-shadow-lg)',
            border: '1px solid var(--na-border-subtle)',
          }}
        >
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
              className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
              style={{
                background: mode === m.id ? 'var(--na-bg-active)' : 'transparent',
              }}
            >
              <div
                className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0 mt-0.5"
                style={{ background: m.softColor }}
              >
                <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
                    {m.label}
                  </span>
                  {mode === m.id && <Check className="w-3 h-3" style={{ color: m.color }} />}
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
                  {m.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
