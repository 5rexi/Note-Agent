import type { ComponentType } from 'react'
import ImageViewer from './ImageViewer'
import PDFViewer from './PDFViewer'
import WordViewer from './WordViewer'
import ExcelViewer from './ExcelViewer'
import PPTViewer from './PPTViewer'
import type { FileKind } from './file-types'

/**
 * Unified prop set passed to every file viewer. Individual viewers
 * destructure only what they use; the extras are forward-compatible.
 */
export interface FileViewerProps {
  filePath: string
  ext?: string
  fileName?: string
  /** Switch the current tab back to plain-text mode (useful for unknown / unsupported files). */
  onViewAsText?: () => void
}

/**
 * Registry of binary/document viewers keyed by FileKind.
 *
 * `markdown` and `code` are intentionally absent — those are handled by
 * the Monaco editor inline.
 *
 * `latex` is also absent because the editor needs to coordinate it with
 * the on/off `latexEnabled` toggle and the compile state. Once that
 * logic is extracted into a hook the viewer can join the registry.
 *
 * `unknown` falls through to UnsupportedViewer which Editor renders
 * directly because it needs the `onViewAsText` callback to flip back
 * into the code lane.
 */
export const viewerRegistry: Partial<Record<FileKind, ComponentType<FileViewerProps>>> = {
  image: ImageViewer as ComponentType<FileViewerProps>,
  pdf: PDFViewer as ComponentType<FileViewerProps>,
  word: WordViewer as ComponentType<FileViewerProps>,
  excel: ExcelViewer as ComponentType<FileViewerProps>,
  ppt: PPTViewer as ComponentType<FileViewerProps>,
}
