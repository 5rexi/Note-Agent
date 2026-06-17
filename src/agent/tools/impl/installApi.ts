/**
 * InstallApiTool — the ONLY sanctioned way to register an API data source.
 *
 * GATED: only registered when the user triggers "Create API" from the UI.
 *
 * Writes into `<workspace>/.note_agent/apis/<id>.json`, the location the
 * ManagerModal reads. Whatever the source docs say about config placement is
 * ignored — APIs live in the workspace's `.note_agent/apis/`.
 */
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  id: z.string().describe('API slug — lowercase, kebab-case. Becomes the <id>.json filename. Reusing it overwrites.'),
  name: z.string().describe('Human-readable API name.'),
  description: z.string().describe('What the API does and when to use it.'),
  baseUrl: z.string().describe('Base URL of the API, e.g. https://api.example.com/v1.'),
  content: z.string().optional().describe('Markdown reference: endpoints, params, auth, examples. Helps the agent call the API later.'),
  auth: z.string().optional().describe('Auth notes (e.g. "Bearer token in NOTE_API_KEY env"). Do NOT hardcode secrets.'),
})

type Input = z.infer<typeof inputSchema>

export const InstallApiTool: Tool<Input, string> = {
  name: 'installApi',
  description: `Register an API data source into the workspace's \`.note_agent/apis/<id>.json\`. This is the ONLY correct place.

## Hard Rules
- Always write to \`.note_agent/apis/\` — never a global config or the source project's own config dir.
- Capture enough in \`content\` (endpoints, params, auth scheme, example requests) that the API can be called later via the http/webFetch tools.
- Never hardcode secrets; describe where the key comes from in \`auth\`.`,
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions() { return { result: 'allow' } },

  validateInput(raw) { return inputSchema.parse(raw) },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    if (!ctx.workspacePath) return { data: '', error: 'No workspace open; cannot install API.' }
    const slug = input.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) return { data: '', error: `Invalid API id: "${input.id}"` }

    const dir = join(ctx.workspacePath, '.note_agent', 'apis')
    mkdirSync(dir, { recursive: true })

    const payload = {
      name: input.name,
      description: input.description,
      baseUrl: input.baseUrl,
      auth: input.auth ?? '',
      content: input.content ?? '',
    }
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify(payload, null, 2), 'utf-8')

    return { data: `Registered API "${input.name}" at .note_agent/apis/${slug}.json.` }
  },

  renderToolUse(input) { return `Install API: ${input.name} (.note_agent/apis/${input.id}.json)` },
}
