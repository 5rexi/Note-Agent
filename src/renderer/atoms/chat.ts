import { atom } from 'jotai'

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls: string | null
  tool_results: string | null
  reasoningContent: string | null
  created_at: number
}

export const messagesAtom = atom<Message[]>([])
