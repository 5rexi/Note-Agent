import { atom } from 'jotai'

export interface Workspace {
  id: string
  name: string
  path: string
  model_tier?: 'fast' | 'balanced' | 'strong' | null
  editor_state?: string | null
  created_at: number
  updated_at: number
}

export interface TaskFolder {
  id: string
  workspace_id: string
  name: string
  created_at: number
  updated_at: number
}

export const workspacesAtom = atom<Workspace[]>([])
export const currentWorkspaceIdAtom = atom<string | null>(null)
export const taskFoldersAtom = atom<TaskFolder[]>([])

export const currentWorkspaceAtom = atom((get) => {
  const id = get(currentWorkspaceIdAtom)
  return get(workspacesAtom).find((w) => w.id === id) ?? null
})
