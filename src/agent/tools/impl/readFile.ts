import { readFileSync, existsSync, statSync } from 'fs'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { extractDocxRawText } from '../../document'

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file from workspace root'),
})

type Input = z.infer<typeof inputSchema>

const MAX_DOCX_CHARS = 8000
const DOCX_TRUNCATION_NOTICE =
  '\n\n[...文档内容已截断 — 该文件共 {total} 字符。建议：1) 先分析已读取部分了解文档结构；2) 如需搜索特定内容，使用 grepSearch 工具；3) 如需继续读取，可指定范围分段读取。]'

export const ReadFileTool: Tool<Input, string> = {
  name: 'readFile',
  description: 'Read the content of a text file in the workspace.',
  inputSchema,
  aliases: ['read'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  maxResultSizeChars: 20000,

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    const filePath = safePath(input.path, ctx.workspacePath)
    if (!existsSync(filePath)) {
      return { data: '', error: `File not found: ${input.path}` }
    }
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      return { data: '', error: `Path is a directory: ${input.path}` }
    }
    const ext = filePath.split('.').pop()?.toLowerCase()

    // Extract text from Word documents
    if (ext === 'docx') {
      try {
        const mammoth = await import('mammoth')
        const buffer = readFileSync(filePath)
        const result = await mammoth.extractRawText({ buffer })
        let text = result.value || ''
        if (text.length > MAX_DOCX_CHARS) {
          const notice = DOCX_TRUNCATION_NOTICE.replace('{total}', String(text.length))
          text = text.slice(0, MAX_DOCX_CHARS) + notice
        }
        fileStateCache.record(filePath)
        return { data: text }
      } catch (err: any) {
        // Fallback: use robust DOMParser extraction when mammoth chokes on
        // unusual Unicode characters (xmlbuilder "Invalid character").
        const fallback = await extractDocxRawText(filePath)
        if (fallback.error) {
          return { data: '', error: `Failed to read Word document: ${err.message}` }
        }
        let text = fallback.text
        if (text.length > MAX_DOCX_CHARS) {
          const notice = DOCX_TRUNCATION_NOTICE.replace('{total}', String(text.length))
          text = text.slice(0, MAX_DOCX_CHARS) + notice
        }
        fileStateCache.record(filePath)
        return { data: text }
      }
    }

    // Extract spreadsheet content (xlsx/xls) as CSV text, one block per sheet.
    if (ext === 'xlsx' || ext === 'xls') {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(readFileSync(filePath), { type: 'buffer' })
        const parts: string[] = []
        for (const name of wb.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
          parts.push(`## Sheet: ${name}\n${csv}`.trim())
        }
        let text = parts.join('\n\n')
        if (text.length > MAX_DOCX_CHARS) {
          text = text.slice(0, MAX_DOCX_CHARS) + DOCX_TRUNCATION_NOTICE.replace('{total}', String(text.length))
        }
        fileStateCache.record(filePath)
        return { data: text || '(empty spreadsheet)' }
      } catch (err: any) {
        return { data: '', error: `Failed to read spreadsheet: ${err.message}` }
      }
    }

    // Skip binary files (simple heuristic)
    const content = readFileSync(filePath, 'utf-8')
    if (content.includes('\x00')) {
      return { data: '', error: `Binary file skipped: ${input.path}` }
    }

    // Record file state for stale-write detection
    fileStateCache.record(filePath)

    return { data: content }
  },

  renderToolUse(input) {
    return `Read file: ${input.path}`
  },
}
