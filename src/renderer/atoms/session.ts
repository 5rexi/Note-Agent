import { atom } from 'jotai'
import { currentWorkspaceAtom } from './workspace'
import { currentTaskIdAtom } from './task'

export interface Session {
  id: string
  task_id: string
  mode: 'explore' | 'ask' | 'execute' | 'research'
  tier_override?: 'weak' | 'medium' | 'strong' | null
  model_override?: string | null
  created_at: number
}

export const currentSessionAtom = atom<Session | null>(null)

export const sessionModelOverrideAtom = atom<{
  tier?: 'weak' | 'medium' | 'strong'
  model?: string
} | null>(null)

export const currentModelTierAtom = atom((get) => {
  const override = get(sessionModelOverrideAtom)
  if (override?.tier) return override.tier
  if (override?.model) return 'custom' as const

  const workspace = get(currentWorkspaceAtom)
  if (workspace?.model_tier) {
    const tierMap: Record<string, 'weak' | 'medium' | 'strong'> = {
      fast: 'weak',
      balanced: 'medium',
      strong: 'strong',
    }
    return tierMap[workspace.model_tier] || 'medium'
  }

  return 'medium' as const
})

// ── Streaming state ──

export const streamingTaskIdAtom = atom<string | null>(null)

/** Set of all task IDs that currently have an active streaming agent session. */
export const streamingTaskIdsAtom = atom<Set<string>>(new Set<string>())

export interface SessionStreamingState {
  isStreaming: boolean
  content: string
  thinkContent: string
  mode: 'explore' | 'ask' | 'execute' | 'research' | null
  toolCalls: Array<{
    id: string
    name: string
    args: any
    status: 'running' | 'completed' | 'failed' | 'confirming' | 'needs-confirmation' | 'rejected'
    result?: any
    isSubagent?: boolean
  }>
  todos?: Array<{ text: string; completed: boolean }>
  todoProgress?: { completed: number; total: number }
  error: string | null
}

export const sessionStreamingStatesAtom = atom<Record<string, SessionStreamingState>>({})

/** True iff the current task has a live streaming session. */
export const isCurrentTaskStreamingAtom = atom((get) => {
  const taskId = get(currentTaskIdAtom)
  if (!taskId) return false
  return get(streamingTaskIdsAtom).has(taskId)
})
