/**
 * Framework-agnostic document operations shared between the Electron main
 * process (for IPC) and agent tools (for autonomous workflows).
 *
 * Today this module only owns the .docx paragraph-replacement pipeline.
 * Future additions should follow the same pattern: pure logic here, with
 * Electron-coupled wrappers (db history, IPC events) living in src/main.
 *
 * Migration TODO: extract the rest of word-office.ts (extractDocxText,
 * analyzeDocxStructure, convertDocxToIndexedHtml, createFromMarkdown,
 * convertWithSoffice) and latex-office.ts here, then expose them as
 * agent tools.
 */
export {
  unpackDocx,
  packDocx,
  prettyPrintXml,
  autoRepairXml,
  replaceParagraphText,
  addParagraphText,
  deleteParagraph,
  modifyParagraphFormat,
  modifyGlobalFormat,
  sanitizeXmlString,
  extractDocxRawText,
  type UnpackResult,
  type PackResult,
  type ReplaceParagraphOptions,
  type FormatChange,
} from './word-paragraph'

export {
  openDocx,
  saveDocx,
  closeDocx,
  resolvePath,
  getElementInfo,
  queryElements,
  parseSelector,
  getDocumentOutline,
  getDocumentText,
  getDocumentStats,
  getDocumentIssues,
  type DocxDocument,
  type DocxElement,
  type DocxNavError,
  type QuerySelector,
  type DocumentRun,
} from './docx-navigator'
