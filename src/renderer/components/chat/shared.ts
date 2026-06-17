import {
  Sparkles, Zap, Terminal, FlaskConical,
  FileText, FolderOpen, Search, FilePlus, FileEdit,
} from 'lucide-react'

export const modeConfig = {
  explore: { label: '探索', color: '#2563EB', bg: 'rgba(37,99,235,0.08)', icon: Sparkles },
  ask: { label: '询问', color: '#059669', bg: 'rgba(5,150,105,0.08)', icon: Zap },
  execute: { label: '执行', color: '#D97706', bg: 'rgba(217,119,6,0.08)', icon: Terminal },
  research: { label: '研究', color: '#7C3AED', bg: 'rgba(124,58,237,0.08)', icon: FlaskConical },
} as const

export const statusConfig: Record<string, { label: string; color: string }> = {
  temp: { label: '临时', color: '#8B5CF6' },
  todo: { label: '待办', color: '#737373' },
  in_progress: { label: '进行中', color: '#2563EB' },
  done: { label: '已完成', color: '#059669' },
  archived: { label: '归档', color: '#737373' },
}

/** Tool name → icon component, used by the streaming card and history renderer. */
export const toolIcons: Record<string, any> = {
  readFile: FileText,
  listFiles: FolderOpen,
  grepSearch: Search,
  globSearch: Search,
  writeFile: FilePlus,
  editFile: FileEdit,
  executeCommand: Terminal,
}

export function getLastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  return lines[lines.length - 1] || ''
}

/**
 * Legacy metadata extraction — old messages stored toolCalls/thinkContent
 * inside an HTML comment marker. New messages use real DB columns.
 */
export function extractMetadata(content: string): {
  content: string
  metadata: { toolCalls?: any[]; thinkContent?: string }
} {
  const match = content.match(/<!--NA_META:([A-Za-z0-9+/=]+)-->/)
  if (!match) return { content, metadata: {} }
  try {
    const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const metadata = JSON.parse(json)
    const cleanContent = content.replace(/<!--NA_META:.*?-->\n?\n?/g, '').trim()
    return { content: cleanContent, metadata }
  } catch {
    return { content, metadata: {} }
  }
}

// ── Reply card helpers ──

/** Strip common Markdown markers so previews/summaries read as plain text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code
    .replace(/`([^`]+)`/g, '$1')          // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/^\s*[-*+]\s+/gm, '')        // bullets
    .replace(/^\s*\d+\.\s+/gm, '')        // ordered list
    .replace(/^\s*>\s?/gm, '')            // blockquote
    .replace(/\*\*([^*]+)\*\*/g, '$1')    // bold
    .replace(/\*([^*]+)\*/g, '$1')        // italic
    .replace(/^\s*[-=]{3,}\s*$/gm, '')    // hr
    .trim()
}

/**
 * Derive a one-line card title from a reply.
 * Order: a short trailing wrap-up line (the reply's own summary, if it ends with one) →
 * the first Markdown heading → the first sentence. Falls back to a generic label.
 */
export function deriveCardSummary(cleanContent: string): string {
  const raw = cleanContent.trim()
  if (!raw) return 'Reply'

  // First Markdown heading near the top.
  const heading = raw.match(/^#{1,6}\s+(.+)$/m)

  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length > 1) {
    const lastLine = stripMarkdown(paras[paras.length - 1]).split('\n').map((l) => l.trim()).filter(Boolean).pop() || ''
    // A short final line that looks like a conclusion (not a code/list fragment).
    if (lastLine && lastLine.length <= 120 && /[.!?。！？]$/.test(lastLine)) {
      return lastLine
    }
  }

  if (heading) return stripMarkdown(heading[1]).slice(0, 120)

  const firstSentence = stripMarkdown(raw).replace(/\s+/g, ' ').trim()
  const m = firstSentence.match(/^.*?[.!?。！？](\s|$)/)
  return (m ? m[0] : firstSentence).trim().slice(0, 100) || 'Reply'
}

/** Plain-text preview (first few lines, markdown stripped). */
export function derivePreview(cleanContent: string, maxLines = 3): string {
  const lines = stripMarkdown(cleanContent)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.slice(0, maxLines).join('\n')
}

/** Tools that count as "edited a file" for the meta chip. */
export const EDIT_TOOL_NAMES = [
  'writeFile', 'writeFileBase64', 'editFile', 'editFileRange', 'appendFile',
  'createDocument', 'wordFillTemplate', 'replaceWordParagraph',
  'wordSet', 'wordBatchSet', 'wordAdd', 'wordRemove', 'wordRaw',
]

/** Summarize a reply's tool calls for the card footer chips. */
export function summarizeMeta(toolCalls?: any[]): { tools: number; filesEdited: number } {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return { tools: 0, filesEdited: 0 }
  const editPaths = new Set<string>()
  let edits = 0
  for (const tc of toolCalls) {
    if (EDIT_TOOL_NAMES.includes(tc?.name)) {
      const p = tc?.args?.path || tc?.args?.filePath
      if (typeof p === 'string') editPaths.add(p)
      else edits++
    }
  }
  return { tools: toolCalls.length, filesEdited: editPaths.size + edits }
}
