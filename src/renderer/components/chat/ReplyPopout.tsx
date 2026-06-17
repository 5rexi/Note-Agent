import { useEffect, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { extractMetadata, deriveCardSummary } from './shared'
import { AiMessageContent } from './AiMessageContent'

/**
 * Pop-out view of a single reply. Fills the chat panel with a small margin on
 * all four edges (anchors to the nearest positioned ancestor — the messages
 * container must be `relative`). Closes on ✕, Esc, and backdrop click.
 */
export function ReplyPopout({
  content,
  toolCalls,
  reasoningContent,
  onClose,
  onApplyToDocx,
}: {
  content: string
  toolCalls?: any[]
  reasoningContent?: string
  onClose: () => void
  onApplyToDocx?: () => void
}) {
  const { content: clean } = extractMetadata(content)
  const summary = deriveCardSummary(clean)

  // Play a close animation before unmounting (the open animation had no
  // matching exit). Delay the real onClose until the exit finishes.
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 150)
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className={`absolute inset-0 z-30 flex ${closing ? 'na-backdrop-out' : 'na-backdrop-in'}`}
      style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(2px)' }}
      onClick={close}
    >
      <div
        className={`absolute inset-5 flex flex-col rounded-2xl overflow-hidden ${closing ? 'na-popout-out' : 'na-popout-in'}`}
        style={{ background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)', border: '1px solid var(--na-border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--na-border-subtle)' }}
        >
          <div className="flex-1 min-w-0 text-[13px] font-semibold truncate" style={{ color: 'var(--na-text-primary)' }}>
            {summary}
          </div>
          <button
            onClick={close}
            className="shrink-0 p-1.5 rounded-md transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 group">
          <AiMessageContent
            content={content}
            toolCalls={toolCalls}
            reasoningContent={reasoningContent}
            onApplyToDocx={onApplyToDocx}
          />
        </div>
      </div>
    </div>
  )
}
