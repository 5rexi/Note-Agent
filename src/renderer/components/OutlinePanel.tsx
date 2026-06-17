import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { List } from 'lucide-react'
import { outlineAtom, type OutlineItem } from '../atoms'
import { useT } from '../hooks/useT'

/**
 * Chapter/heading outline for the active document. Populated by the Editor
 * (md/latex) or WordViewer (docx); clicking an item jumps there. Scrollable;
 * the current chapter is highlighted and kept in view.
 */
export default function OutlinePanel() {
  const { t } = useT()
  const { items, activeId } = useAtomValue(outlineAtom)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Keep the highlighted chapter visible as it changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  if (items.length === 0) return null

  const jump = (item: OutlineItem) => {
    window.dispatchEvent(new CustomEvent('outline:jump', { detail: item }))
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0">
        <List className="w-3 h-3" style={{ color: 'var(--na-text-tertiary)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-tertiary)' }}>{t('outline')}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-2">
        {items.map((it) => {
          const active = it.id === activeId
          return (
            <button
              key={it.id}
              ref={active ? activeRef : undefined}
              onClick={() => jump(it)}
              title={it.title}
              className="w-full text-left flex items-center transition-colors hover:bg-[var(--na-bg-hover)]"
              style={{
                paddingLeft: 12 + (Math.min(it.level, 5) - 1) * 12,
                paddingRight: 10,
                paddingTop: 3,
                paddingBottom: 3,
                background: active ? 'var(--na-bg-active)' : 'transparent',
                borderLeft: active ? '2px solid var(--na-primary)' : '2px solid transparent',
              }}
            >
              <span
                className="truncate text-[12px]"
                style={{
                  color: active ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                  fontWeight: it.level <= 1 ? 600 : active ? 600 : 400,
                }}
              >
                {it.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
