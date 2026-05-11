import { useState } from 'react'
import { ChevronDown, ChevronUp, Quote } from 'lucide-react'

export interface QuoteBlock {
  type: 'quote'
  fileName: string
  fullText: string
}

export interface TextSegment {
  type: 'text'
  content: string
}

export type MessageSegment = QuoteBlock | TextSegment

/**
 * Parse message content for quote blocks.
 *
 * Quote format:
 *   [引用自 filename]
 *   "quoted text..."
 *   [/引用]
 */
export function parseMessageWithQuotes(content: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  const regex = /\[引用自 ([^\]]+)\]\n?([\s\S]*?)\n?\[\/引用\]/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const [fullMatch, fileName, fullText] = match
    const startIndex = match.index

    // Text before this quote
    if (startIndex > lastIndex) {
      const before = content.slice(lastIndex, startIndex).trimEnd()
      if (before) {
        segments.push({ type: 'text', content: before })
      }
    }

    segments.push({
      type: 'quote',
      fileName: fileName.trim(),
      fullText: fullText.trim(),
    })

    lastIndex = startIndex + fullMatch.length
  }

  // Remaining text after last quote
  if (lastIndex < content.length) {
    const after = content.slice(lastIndex).trimStart()
    if (after) {
      segments.push({ type: 'text', content: after })
    }
  }

  // No quotes found — return whole content as single text segment
  if (segments.length === 0) {
    segments.push({ type: 'text', content })
  }

  return segments
}

interface CollapsibleQuoteProps {
  fileName: string
  fullText: string
  defaultExpanded?: boolean
}

export function CollapsibleQuote({ fileName, fullText, defaultExpanded = false }: CollapsibleQuoteProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div
      className="my-1.5 rounded-md overflow-hidden"
      style={{
        border: '1px solid var(--na-border-subtle)',
        background: 'var(--na-bg-active)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
        style={{
          background: 'var(--na-bg-hover)',
          color: 'var(--na-text-secondary)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--na-bg-active)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--na-bg-hover)'
        }}
      >
        <Quote className="w-3 h-3 shrink-0" />
        <span className="text-[11px] font-medium truncate flex-1">
          引用自 {fileName}
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
      </button>
      {expanded && (
        <div
          className="px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap"
          style={{
            color: 'var(--na-text-secondary)',
            borderTop: '1px solid var(--na-border-subtle)',
          }}
        >
          {fullText}
        </div>
      )}
    </div>
  )
}
