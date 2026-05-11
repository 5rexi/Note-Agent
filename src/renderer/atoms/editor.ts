import { atom } from 'jotai'

export interface EditorState {
  openFiles: string[]
  activeFileIndex: number
  fileStates: Record<string, { cursorLine: number; cursorColumn: number; scrollTop: number }>
  editorView: 'edit' | 'split' | 'preview'
  sidebarMode: 'tasks' | 'files'
}

export const editorStateAtom = atom<EditorState>({
  openFiles: [],
  activeFileIndex: 0,
  fileStates: {},
  editorView: 'edit',
  sidebarMode: 'tasks',
})

export const currentFilePathAtom = atom((get) => {
  const state = get(editorStateAtom)
  return state.openFiles[state.activeFileIndex] ?? null
})
