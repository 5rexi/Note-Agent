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
