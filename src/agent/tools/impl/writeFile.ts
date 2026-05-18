import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { safePath } from '../../utils/fs-guard'
import { fileStateCache } from '../../file-cache/FileStateCache'
import { recordFileEdit } from './history'

// ── Anti-split guard: tracks EVERY writeFile call in this session ──
// If the same file is written twice within SPLIT_WINDOW_MS, the 2nd+ calls
// are blocked. This prevents the Agent from 'building up' a file across
// multiple writeFile calls (each overwriting the previous one, wasting
// tokens by re-transmitting content already written).
const recentlyWrittenFiles = new Map<string, number>()
const SPLIT_WINDOW_MS = 120_000 // 2 minutes

function wasRecentlyWrittenByWriteFile(filePath: string): boolean {
  const ts = recentlyWrittenFiles.get(filePath)
  if (!ts) return false
  if (Date.now() - ts > SPLIT_WINDOW_MS) {
    recentlyWrittenFiles.delete(filePath)
    return false
  }
  return true
}

const inputSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe(
    '⚠️ COMPLETE file content — MUST be the FULL content in ONE call. ' +
    'NEVER split into multiple writeFile calls (e.g. "write part 1 now, part 2 later"). ' +
    'writeFile ALWAYS overwrites the entire file. For long files, compose everything in reasoning first, then call once.'
  ),
})

type Input = z.infer<typeof inputSchema>

export const WriteFileTool: Tool<Input, { path: string; bytes: number }> = {
  name: 'writeFile',
  description:
    '⚠️ CRITICAL: Create or overwrite a file. The content parameter MUST contain the COMPLETE file content in ONE call. ' +
    'NEVER split a file into multiple writeFile calls. If the content is long, compose the FULL content in your reasoning first, ' +
    'then make a SINGLE writeFile call with the entire string. writeFile always overwrites the entire file — there is NO append mode.',
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx) {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''

    // Empty or whitespace-only content is almost always a mistake.
    // The model may "plan" to create a file first then fill it, but writeFile
    // OVERWRITES — there is no "touch then fill" pattern. Reject immediately.
    if (content.trim().length === 0) {
      return {
        result: 'deny',
        reason:
          `writeFile content is empty. You cannot create an empty file and then "fill it later" — writeFile ALWAYS overwrites.\n` +
          `If you want to build a document section by section, use the PLACEHOLDER pattern (writeFile skeleton + editFile) or use appendFile.`,
      }
    }

    if (ctx.mode === 'ask') {
      return {
        result: 'ask',
        description: `Write file: ${path} (${content.length} bytes)`,
      }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow writing files' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ path: string; bytes: number }>> {
    const filePath = safePath(input.path, ctx.workspacePath)
    const existedBefore = existsSync(filePath)

    // ── Anti-split guard ──
    // Block repeated writeFile calls to the SAME file within 2 minutes.
    // The Agent's natural tendency is to "write part 1, then part 2, then part 3"
    // by calling writeFile repeatedly with ever-longer content (each call
    // includes all previous content + new content). This wastes huge amounts
    // of tokens. Force the Agent to compose the FULL content in reasoning
    // first, then make ONE writeFile call.
    if (wasRecentlyWrittenByWriteFile(filePath)) {
      return {
        data: { path: input.path, bytes: 0 },
        error:
          `BLOCKED: You already wrote to "${input.path}" just now. ` +
          `writeFile OVERWRITES the entire file every time. ` +
          `Calling it again wastes tokens by re-transmitting content you already wrote.\n\n` +
          `You must choose ONE of these approaches:\n` +
          `\n` +
          `A) COMPOSE FIRST — RECOMMENDED\n` +
          `   Use your reasoning to write the ENTIRE document first (all sections).\n` +
          `   Then call writeFile ONCE with the complete content.\n` +
          `   This is the correct way for new files.\n` +
          `\n` +
          `B) PLACEHOLDER PATTERN — for VERY LONG documents\n` +
          `   1. writeFile with skeleton:  # Title\\n\\n## Section 1\\n<!-- SECTION_1 -->\\n\\n## Section 2\\n<!-- SECTION_2 -->\n` +
          `   2. editFile to replace each marker with real content.\n` +
          `\n` +
          `C) MODIFY EXISTING FILE\n` +
          `   Use readFile to read the current content, compose the merged version\n` +
          `   in reasoning, then ONE writeFile call with the complete merged content.`
      }
    }

    // Stale write protection for existing files
    if (existedBefore) {
      try {
        fileStateCache.assertUnchanged(filePath)
      } catch (err: any) {
        return { data: { path: input.path, bytes: 0 }, error: err.message }
      }
    }

    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, input.content, 'utf-8')

    // Track this write for anti-split guard (ALL writes, not just creations)
    recentlyWrittenFiles.set(filePath, Date.now())

    // Notify renderer that file changed (so editor refreshes)
    try {
      const { notifyFileChanged } = require('../../../main/file-notify')
      notifyFileChanged(filePath)
    } catch {
      // ignore in test environment
    }

    // Record state after write
    fileStateCache.record(filePath)
    recordFileEdit(filePath, {
      timestamp: Date.now(),
      toolName: 'writeFile',
      toolCallId: '',
      preview: `wrote ${input.content.length} bytes`,
    })

    const action = existedBefore ? 'OVERWROTE' : 'created'
    return {
      data: { path: input.path, bytes: input.content.length },
      preview: `${action} ${input.path} (${input.content.length} bytes)${existedBefore ? ' — previous content was replaced!' : ''}`,
    }
  },

  renderToolUse(input) {
    const path = typeof input.path === 'string' ? input.path : '(unknown)'
    const content = typeof input.content === 'string' ? input.content : ''
    return `Write file: ${path} (${content.length} bytes)`
  },
}
