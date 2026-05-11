import { atom } from 'jotai'
import { currentWorkspaceIdAtom } from './workspace'

export interface Task {
  id: string
  workspace_id: string
  folder_id: string | null
  title: string
  status: 'todo' | 'in_progress' | 'done' | 'archived' | 'temp'
  editor_state: string | null
  created_at: number
  updated_at: number
  workspace_name?: string
  folder_name?: string
}

export const tasksAtom = atom<Task[]>([])
export const currentTaskIdAtom = atom<string | null>(null)

export const currentTaskAtom = atom((get) => {
  const id = get(currentTaskIdAtom)
  return get(tasksAtom).find((t) => t.id === id) ?? null
})

/** Tasks belonging to the currently selected workspace. */
export const tasksInCurrentWorkspaceAtom = atom((get) => {
  const wsId = get(currentWorkspaceIdAtom)
  if (!wsId) return [] as Task[]
  return get(tasksAtom).filter((t) => t.workspace_id === wsId)
})

export const tasksByStatusAtom = atom((get) => {
  const tasks = get(tasksAtom)
  const groups: Record<string, Task[]> = {
    todo: [],
    in_progress: [],
    done: [],
    archived: [],
    temp: [],
  }
  for (const t of tasks) {
    groups[t.status]?.push(t)
  }
  return groups
})
