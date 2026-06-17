/**
 * Vertical rail of dots — one per agent reply. Click a dot to jump to that reply.
 * Sits on the right edge of the messages area; hover reveals the reply summary.
 */
export function ReplyDots({
  replies,
  activeId,
  onJump,
}: {
  replies: Array<{ id: string; summary: string }>
  activeId?: string | null
  onJump: (id: string) => void
}) {
  if (replies.length < 2) return null
  return (
    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex flex-col items-end gap-1.5 group/dots">
      {replies.map((r, i) => {
        const active = r.id === activeId
        return (
          <button
            key={r.id}
            onClick={() => onJump(r.id)}
            className="group/dot flex items-center gap-1.5"
            title={r.summary}
          >
            {/* Label on hover */}
            <span
              className="max-w-[180px] truncate text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover/dot:opacity-100 transition-opacity pointer-events-none"
              style={{ background: 'var(--na-bg-popover)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
            >
              {i + 1}. {r.summary}
            </span>
            <span
              className="shrink-0 rounded-full transition-all"
              style={{
                width: active ? 9 : 6,
                height: active ? 9 : 6,
                background: active ? 'var(--na-primary)' : 'var(--na-border-default)',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
