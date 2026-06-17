import { atom } from 'jotai'

export interface EditorState {
  openFiles: string[]
  activeFileIndex: number
  fileStates: Record<string, { cursorLine: number; cursorColumn: number; scrollTop: number; previewScrollTop?: number }>
  editorView: 'edit' | 'split' | 'preview'
  sidebarMode: 'tasks' | 'files'
  syncScrollEnabled?: boolean
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

// ── Document outline (chapter menu) ──
export interface OutlineItem {
  id: string
  title: string
  level: number      // 1 = top (chapter/h1/section), larger = deeper
  line?: number       // editor jump target (1-based) for md/latex/code
  top?: number        // word viewer jump target (px) for .docx
}

/** Outline of the active document, populated by whichever viewer owns it
 *  (Editor for md/latex, WordViewer for docx). The OutlinePanel reads it. */
export const outlineAtom = atom<{ items: OutlineItem[]; activeId: string | null }>({
  items: [],
  activeId: null,
})
