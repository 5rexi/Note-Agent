export type FileKind =
  | 'markdown'
  | 'code'
  | 'image'
  | 'pdf'
  | 'latex'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'unknown'

export interface FileTypeInfo {
  label: string
  lang: string
  kind: FileKind
}

export const FILE_TYPE_MAP: Record<string, FileTypeInfo> = {
  // Markdown
  md: { label: 'Markdown', lang: 'markdown', kind: 'markdown' },
  mdx: { label: 'MDX', lang: 'markdown', kind: 'markdown' },
  // Code
  py: { label: 'Python', lang: 'python', kind: 'code' },
  js: { label: 'JavaScript', lang: 'javascript', kind: 'code' },
  ts: { label: 'TypeScript', lang: 'typescript', kind: 'code' },
  jsx: { label: 'JSX', lang: 'javascript', kind: 'code' },
  tsx: { label: 'TSX', lang: 'typescript', kind: 'code' },
  json: { label: 'JSON', lang: 'json', kind: 'code' },
  yaml: { label: 'YAML', lang: 'yaml', kind: 'code' },
  yml: { label: 'YAML', lang: 'yaml', kind: 'code' },
  html: { label: 'HTML', lang: 'html', kind: 'code' },
  htm: { label: 'HTML', lang: 'html', kind: 'code' },
  css: { label: 'CSS', lang: 'css', kind: 'code' },
  scss: { label: 'SCSS', lang: 'scss', kind: 'code' },
  sass: { label: 'Sass', lang: 'sass', kind: 'code' },
  less: { label: 'Less', lang: 'less', kind: 'code' },
  rs: { label: 'Rust', lang: 'rust', kind: 'code' },
  go: { label: 'Go', lang: 'go', kind: 'code' },
  c: { label: 'C', lang: 'c', kind: 'code' },
  cpp: { label: 'C++', lang: 'cpp', kind: 'code' },
  cc: { label: 'C++', lang: 'cpp', kind: 'code' },
  h: { label: 'C Header', lang: 'c', kind: 'code' },
  hpp: { label: 'C++ Header', lang: 'cpp', kind: 'code' },
  java: { label: 'Java', lang: 'java', kind: 'code' },
  kt: { label: 'Kotlin', lang: 'kotlin', kind: 'code' },
  swift: { label: 'Swift', lang: 'swift', kind: 'code' },
  rb: { label: 'Ruby', lang: 'ruby', kind: 'code' },
  php: { label: 'PHP', lang: 'php', kind: 'code' },
  sh: { label: 'Shell', lang: 'shell', kind: 'code' },
  bash: { label: 'Bash', lang: 'shell', kind: 'code' },
  zsh: { label: 'Zsh', lang: 'shell', kind: 'code' },
  ps1: { label: 'PowerShell', lang: 'powershell', kind: 'code' },
  sql: { label: 'SQL', lang: 'sql', kind: 'code' },
  xml: { label: 'XML', lang: 'xml', kind: 'code' },
  svg: { label: 'SVG', lang: 'xml', kind: 'code' },
  dart: { label: 'Dart', lang: 'dart', kind: 'code' },
  lua: { label: 'Lua', lang: 'lua', kind: 'code' },
  r: { label: 'R', lang: 'r', kind: 'code' },
  scala: { label: 'Scala', lang: 'scala', kind: 'code' },
  groovy: { label: 'Groovy', lang: 'groovy', kind: 'code' },
  dockerfile: { label: 'Dockerfile', lang: 'dockerfile', kind: 'code' },
  // Image
  png: { label: 'PNG', lang: 'plaintext', kind: 'image' },
  jpg: { label: 'JPEG', lang: 'plaintext', kind: 'image' },
  jpeg: { label: 'JPEG', lang: 'plaintext', kind: 'image' },
  gif: { label: 'GIF', lang: 'plaintext', kind: 'image' },
  webp: { label: 'WebP', lang: 'plaintext', kind: 'image' },
  bmp: { label: 'BMP', lang: 'plaintext', kind: 'image' },
  ico: { label: 'Icon', lang: 'plaintext', kind: 'image' },
  // PDF
  pdf: { label: 'PDF', lang: 'plaintext', kind: 'pdf' },
  // LaTeX
  tex: { label: 'LaTeX', lang: 'latex', kind: 'latex' },
  ltx: { label: 'LaTeX', lang: 'latex', kind: 'latex' },
  bib: { label: 'BibTeX', lang: 'bibtex', kind: 'code' },
  bst: { label: 'BibTeX Style', lang: 'bibtex', kind: 'code' },
  cls: { label: 'LaTeX Class', lang: 'latex', kind: 'code' },
  sty: { label: 'LaTeX Style', lang: 'latex', kind: 'code' },
  // Word
  docx: { label: 'Word', lang: 'xml', kind: 'word' },
  doc: { label: 'Word', lang: 'xml', kind: 'word' },
  // Excel
  xlsx: { label: 'Excel', lang: 'plaintext', kind: 'excel' },
  xls: { label: 'Excel', lang: 'plaintext', kind: 'excel' },
  csv: { label: 'CSV', lang: 'plaintext', kind: 'excel' },
  // PowerPoint
  pptx: { label: 'PowerPoint', lang: 'plaintext', kind: 'ppt' },
  ppt: { label: 'PowerPoint', lang: 'plaintext', kind: 'ppt' },
}

export function getFileInfo(filePath: string | null): FileTypeInfo & { ext: string } {
  if (!filePath) return { label: '文本', lang: 'plaintext', kind: 'code', ext: '' }
  const lower = filePath.toLowerCase()
  const baseName = lower.split('/').pop() ?? ''
  if (baseName === 'dockerfile' || baseName.endsWith('.dockerfile')) {
    return { ...FILE_TYPE_MAP.dockerfile, ext: 'dockerfile' }
  }
  const ext = baseName.includes('.') ? baseName.split('.').pop() ?? '' : ''
  const info = FILE_TYPE_MAP[ext]
  if (info) return { ...info, ext }
  return { label: '未知', lang: 'plaintext', kind: 'unknown', ext }
}

/** Returns true for kinds that have non-text content (binary, document, etc.). */
export function isBinaryKind(kind: FileKind): boolean {
  return kind === 'image' || kind === 'pdf' || kind === 'word' || kind === 'excel' || kind === 'ppt'
}
