import { useState, useEffect, useRef, useCallback, type ComponentType } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  /** A separator line when true (other fields ignored). */
  separator?: boolean
  icon?: ComponentType<{ className?: string; style?: any }>
  label?: string
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  shortcut?: string
  onClick?: () => void
  /** Render in the danger (red) style. */
  danger?: boolean
  disabled?: boolean
}

interface MenuState { x: number; y: number; items: ContextMenuItem[] }

/**
 * A single modern context menu shared across the app (editor, viewers, sidebar…).
 * `open(e, items)` positions it at the cursor (clamped to the viewport); render
 * the returned `menu` node once. Closes on click, Esc, scroll, or blur.
 */
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setState(null), [])

  const open = useCallback((e: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    if (items.length === 0) return
    e.preventDefault()
    setState({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, items })
  }, [])

  useEffect(() => {
    if (!state) return
    const onDocDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', onDocDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDocDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [state, close])

  // Clamp to the viewport once measured.
  useEffect(() => {
    if (!state || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    let { x, y } = state
    const pad = 8
    if (x + r.width + pad > window.innerWidth) x = window.innerWidth - r.width - pad
    if (y + r.height + pad > window.innerHeight) y = window.innerHeight - r.height - pad
    if (x !== state.x || y !== state.y) setState({ ...state, x: Math.max(pad, x), y: Math.max(pad, y) })
  }, [state])

  const menu = state ? createPortal(
    <div
      ref={ref}
      className="fixed z-[200] py-1 na-popover-appear"
      style={{
        left: state.x, top: state.y, minWidth: 184,
        background: 'var(--na-bg-popover)',
        border: '1px solid var(--na-border-subtle)',
        borderRadius: 'var(--na-radius-lg)',
        boxShadow: 'var(--na-shadow-lg)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px" style={{ background: 'var(--na-border-subtle)' }} />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onMouseDown={(e) => { e.preventDefault(); if (it.disabled) return; close(); it.onClick?.() }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-left transition-colors disabled:opacity-40 disabled:cursor-default"
            style={{ color: it.danger ? '#ef4444' : 'var(--na-text-primary)' }}
            onMouseEnter={(e) => { if (!it.disabled) (e.currentTarget.style.background = it.danger ? 'rgba(239,68,68,0.10)' : 'var(--na-bg-hover)') }}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {it.icon ? <it.icon className="w-3.5 h-3.5 shrink-0" style={{ color: it.danger ? '#ef4444' : 'var(--na-text-tertiary)' }} /> : <span className="w-3.5 shrink-0" />}
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="text-[11px] tabular-nums" style={{ color: 'var(--na-text-tertiary)' }}>{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  ) : null

  return { open, close, menu }
}
