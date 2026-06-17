import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { Wrench, Copy, Check } from 'lucide-react'
import { useT } from '../../hooks/useT'
import { FoldableSection } from './FoldableSection'
import { toolIcons, getLastLine, extractMetadata } from './shared'

/**
 * Renders a completed AI reply: collapsible reasoning, a tool-call list, and the
 * Markdown body. Used both inline (short replies) and inside the pop-out view.
 */
export function AiMessageContent({
  content,
  toolCalls: toolCallsProp,
  reasoningContent,
  onApplyToDocx,
  hideCopy,
}: {
  content: string
  toolCalls?: any[]
  reasoningContent?: string
  onApplyToDocx?: () => void
  /** Hide the built-in bottom copy button (e.g. when a card provides its own). */
  hideCopy?: boolean
}) {
  const { t } = useT()
  // Legacy: parse HTML comment metadata for old messages
  const { content: cleanContent, metadata } = extractMetadata(content)
  const thinkFromMeta = metadata.thinkContent || ''
  const toolCallsFromMeta = metadata.toolCalls || []

  // Prefer new format, fallback to legacy metadata
  const displayThinkContent = reasoningContent || thinkFromMeta
  const displayToolCalls =
    Array.isArray(toolCallsProp) && toolCallsProp.length > 0 ? toolCallsProp : toolCallsFromMeta
  const body = cleanContent

  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div>
      {/* Think section */}
      {displayThinkContent && (
        <div className="mb-3 overflow-hidden" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-active)' }}>
          <FoldableSection title={t('thinkingProcess')} lastLine={getLastLine(displayThinkContent)} defaultOpen={false}>
            {displayThinkContent}
          </FoldableSection>
        </div>
      )}
      {/* Tool call history */}
      {displayToolCalls.length > 0 && (
        <div className="mb-3 overflow-hidden" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-subtle)', background: 'var(--na-bg-active)' }}>
          <FoldableSection title={t('toolCalls')} lastLine={t('toolCallsCount', { count: String(displayToolCalls.length) })} defaultOpen={true}>
            <div className="space-y-1.5">
              {displayToolCalls.map((tc: any) => {
                const Icon = toolIcons[tc.name] || Wrench
                const statusColor: Record<string, string> = {
                  running: '#2563EB',
                  completed: '#059669',
                  failed: '#ef4444',
                  confirming: '#2563EB',
                  'needs-confirmation': '#f59e0b',
                  rejected: '#ef4444',
                }
                const color = statusColor[tc.status] || 'var(--na-text-tertiary)'
                const label: Record<string, string> = {
                  running: t('toolStatusRunning'),
                  completed: t('toolStatusCompleted'),
                  failed: t('toolStatusFailed'),
                  confirming: t('toolStatusConfirming'),
                  'needs-confirmation': t('toolStatusNeedsConfirmation'),
                  rejected: t('toolStatusRejected'),
                }
                return (
                  <div key={tc.id || tc.toolCallId} className="flex items-center gap-2 text-[12px]">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                    <span className="font-medium" style={{ color: 'var(--na-text-secondary)' }}>{tc.name}</span>
                    {tc.args?.path && <span className="opacity-50">— {tc.args.path}</span>}
                    <span className="ml-auto flex items-center gap-1 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      {label[tc.status] || tc.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </FoldableSection>
        </div>
      )}
      {body && (
        <div className="markdown-body text-[13px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
            {body}
          </ReactMarkdown>
        </div>
      )}
      {!hideCopy && (
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 mt-2 px-2 py-1 text-[11px] rounded-md transition-colors opacity-0 group-hover:opacity-100 hover:bg-[var(--na-bg-hover)]"
          style={{ color: 'var(--na-text-tertiary)' }}
          title={t('copyRawContent')}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? t('copied') : t('copy')}
        </button>
      )}
      {onApplyToDocx && (
        <button
          onClick={onApplyToDocx}
          className="flex items-center gap-1 mt-1 px-2 py-1 text-[11px] rounded-md transition-colors opacity-0 group-hover:opacity-100 hover:bg-[var(--na-bg-hover)]"
          style={{ color: '#7C3AED' }}
          title={t('applyToDocx')}
        >
          <Check className="w-3 h-3" />
          {t('applyToDocx')}
        </button>
      )}
    </div>
  )
}
