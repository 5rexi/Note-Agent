import type { ElectronAPI } from '../preload/index'

// Monaco editor ESM API module declarations
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

declare global {
  interface Window {
    electronAPI: import('../preload/index').ElectronAPI
  }
}
