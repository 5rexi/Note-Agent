import { useState } from 'react'
import { Maximize2, Wrench, FileEdit, Copy, Check, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react'
import { extractMetadata, deriveCardSummary, derivePreview, summarizeMeta } from './shared'
import { AiMessageContent } from './AiMessageContent'

/**
 * One AI reply rendered as a card with three states:
 *  - inline (short replies): full content, no toggle.
 *  - expanded (the "long card"): full content with a header bar — used for the
 *    latest reply and any the user opens. Collapse with the chevron, or pop out
 *    to a floating window with the maximize button.
 *  - collapsed: a bold summary + muted preview + meta chips; click to expand.
 */
export function ReplyCard({
  content,
  toolCalls,
  reasoningContent,
  expanded,
  onToggleExpand,
  onPopout,
  onApplyToDocx,
  onRetry,
}: {
  content: string
  toolCalls?: any[]
  reasoningContent?: string
  /** Whether to render as the inline "long card" (full content). */
  expanded: boolean
  /** Toggle inline expand/collapse. */
  onToggleExpand: () => void
  /** Pop the reply out into a floating window. */
  onPopout: () => void
  onApplyToDocx?: () => void
  /** Provided only for the latest reply — shows a retry/regenerate action. */
  onRetry?: () => void
}) {
  const { content: clean } = extractMetadata(content)
  const meta = summarizeMeta(toolCalls)
  const preview = derivePreview(clean, 3)
  const summary = deriveCardSummary(clean)
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(clean); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const copyBtn = (
    <button onClick={handleCopy} title="Copy" className="p-1 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
  const retryBtn = onRetry && (
    <button onClick={(e) => { e.stopPropagation(); onRetry() }} title="Retry" className="p-1 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
      <RotateCcw className="w-3.5 h-3.5" />
    </button>
  )
  const popoutBtn = (
    <button onClick={(e) => { e.stopPropagation(); onPopout() }} title="弹出为窗口" className="p-1 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  )

  // Treat as "simple" when it's short and has no tools/reasoning to surface.
  const isShort = clean.length <= 280 && clean.split('\n').filter(Boolean).length <= 3
  const hasExtras = meta.tools > 0 || !!reasoningContent
  const renderInline = isShort && !hasExtras

  if (renderInline) {
    return (
      <div
        className="relative group rounded-xl px-4 py-3"
        style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-card)', boxShadow: 'var(--na-shadow-sm)' }}
      >
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {copyBtn}{retryBtn}{popoutBtn}
        </div>
        <AiMessageContent content={content} toolCalls={toolCalls} reasoningContent={reasoningContent} onApplyToDocx={onApplyToDocx} hideCopy />
      </div>
    )
  }

  // ── Expanded "long card": header bar + full content ──
  if (expanded) {
    return (
      <div
        className="relative rounded-xl overflow-hidden na-expand-in"
        style={{ border: '1px solid var(--na-primary-soft)', background: 'var(--na-bg-card)', boxShadow: 'var(--na-shadow-sm)' }}
      >
        <div
          className="flex items-center gap-2 px-3.5 py-2.5"
          style={{ borderBottom: '1px solid var(--na-border-subtle)' }}
        >
          <span className="shrink-0 w-1 h-4 rounded-full" style={{ background: 'var(--na-primary)' }} />
          <div className="flex-1 min-w-0 text-[13px] font-semibold leading-snug truncate" style={{ color: 'var(--na-text-primary)' }}>
            {summary}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {copyBtn}{retryBtn}{popoutBtn}
            <button onClick={onToggleExpand} title="折叠" className="p-1 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="px-4 py-3 group">
          <AiMessageContent content={content} toolCalls={toolCalls} reasoningContent={reasoningContent} onApplyToDocx={onApplyToDocx} hideCopy />
        </div>
      </div>
    )
  }

  // ── Collapsed summary card ──
  return (
    <div
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onToggleExpand() }}
      className="relative group w-full text-left rounded-xl px-4 py-3.5 transition-all hover:-translate-y-0.5 cursor-pointer na-card-hover"
      style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-card)', boxShadow: 'var(--na-shadow-sm)' }}
    >
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {copyBtn}{retryBtn}{popoutBtn}
        <button onClick={(e) => { e.stopPropagation(); onToggleExpand() }} title="展开" className="p-1 rounded-md hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Header: accent rail + summary */}
      <div className="flex items-start gap-2.5 pr-20">
        <span className="mt-1 shrink-0 w-1 h-4 rounded-full" style={{ background: 'var(--na-primary)' }} />
        <div className="flex-1 min-w-0 text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--na-text-primary)' }}>
          {summary}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div
          className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
          style={{
            color: 'var(--na-text-secondary)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {preview}
        </div>
      )}

      {/* Meta chips */}
      {(meta.tools > 0 || meta.filesEdited > 0) && (
        <div className="mt-2.5 flex items-center gap-3 text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
          {meta.tools > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" /> {meta.tools} tools
            </span>
          )}
          {meta.filesEdited > 0 && (
            <span className="flex items-center gap-1">
              <FileEdit className="w-3 h-3" /> {meta.filesEdited} files edited
            </span>
          )}
        </div>
      )}
    </div>
  )
}
