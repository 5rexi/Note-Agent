/**
 * GrepSearchTool — 搜索文件内容（不依赖外部命令）
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const inputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Directory or file to search in'),
})

type Input = z.infer<typeof inputSchema>

interface GrepMatch {
  file: string
  line: number
  content: string
}

function searchInFile(filePath: string, fileRelPath: string, regex: RegExp): GrepMatch[] {
  const matches: GrepMatch[] = []
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Reset lastIndex for global regex before each test
      regex.lastIndex = 0
      if (regex.test(lines[i])) {
        matches.push({
          file: fileRelPath,
          line: i + 1,
          content: lines[i].trim(),
        })
      }
    }
  } catch {
    // Skip unreadable files
  }
  return matches
}

function walkDir(dir: string, baseDir: string, regex: RegExp, results: GrepMatch[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      const relPath = relative(baseDir, fullPath)
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir, regex, results)
      } else {
        results.push(...searchInFile(fullPath, relPath, regex))
      }
    }
  } catch {
    // Skip unreadable directories
  }
}

export const GrepSearchTool: Tool<Input, GrepMatch[]> = {
  name: 'grepSearch',
  description: 'Search file contents using regex across the workspace.',
  inputSchema,
  aliases: ['grep', 'search'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<GrepMatch[]>> {
    try {
      const regex = new RegExp(input.pattern, 'g')
      const target = input.path || '.'
      const results: GrepMatch[] = []

      const targetPath = join(ctx.workspacePath, target)
      const stat = statSync(targetPath)

      if (stat.isFile()) {
        results.push(...searchInFile(targetPath, target, regex))
      } else {
        walkDir(targetPath, ctx.workspacePath, regex, results)
      }

      return { data: results }
    } catch (err: any) {
      return { data: [], error: `Search failed: ${err.message}` }
    }
  },

  renderToolUse(input) {
    return `Grep: "${input.pattern}" in ${input.path || '.'}`
  },
}
