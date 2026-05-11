import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface FoldableSectionProps {
  title: string
  lastLine?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function FoldableSection({
  title,
  lastLine,
  children,
  defaultOpen = false,
}: FoldableSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors hover:bg-[var(--na-bg-hover)]"
      >
        <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--na-text-secondary)' }}>
          {title}
        </span>
        {lastLine && (
          <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: 'var(--na-text-tertiary)' }}>
            {lastLine}
          </span>
        )}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
        )}
      </button>
      {open && (
        <div
          className="px-3 pb-3 text-[12px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--na-text-secondary)' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
