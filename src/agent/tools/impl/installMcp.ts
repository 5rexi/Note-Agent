/**
 * InstallMcpTool — the ONLY sanctioned way to register an MCP server.
 *
 * GATED: only registered when the user triggers "Create MCP" from the UI.
 *
 * Writes into `~/.note_agent/mcp.json` (the single config Note Agent reads via
 * loadMCPConfig). It does NOT install anything globally — for npx-based servers
 * the command/args are stored and run on demand by the MCP client. Whatever the
 * source README says about install location is ignored.
 */
import { z } from 'zod'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  name: z.string().describe('Unique server name (used as the key). Re-using a name replaces that server.'),
  transport: z.enum(['stdio', 'sse']).describe("'stdio' for local command servers (npx/uvx/python), 'sse' for remote HTTP servers."),
  command: z.string().optional().describe("For stdio: the executable, e.g. 'npx' or 'uvx' or 'python'. Stored, not installed globally."),
  args: z.array(z.string()).optional().describe("For stdio: command args, e.g. ['-y', '@modelcontextprotocol/server-filesystem', '/path']."),
  url: z.string().optional().describe('For sse: the server URL.'),
  env: z.record(z.string(), z.string()).optional().describe('Environment variables (e.g. API keys) for the server process.'),
})

type Input = z.infer<typeof inputSchema>

export const InstallMcpTool: Tool<Input, string> = {
  name: 'installMcp',
  description: `Register an MCP server into Note Agent's config (\`~/.note_agent/mcp.json\`). This is the ONLY correct place — never edit \`.claude\`, \`.cursor\`, \`.vscode\`, or any other agent's MCP config.

## Hard Rules
- For stdio servers (npx/uvx), store the launch command in \`command\`+\`args\`. Do NOT run a global install — the command is executed on demand.
- transport 'stdio' requires \`command\`; transport 'sse' requires \`url\`.
- Put secrets/API keys in \`env\`.
- Reusing a \`name\` overwrites that server entry.`,
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions() { return { result: 'allow' } },

  validateInput(raw) {
    const parsed = inputSchema.parse(raw)
    if (parsed.transport === 'stdio' && !parsed.command) throw new Error("stdio transport requires 'command'")
    if (parsed.transport === 'sse' && !parsed.url) throw new Error("sse transport requires 'url'")
    return parsed
  },

  async call(input): Promise<ToolResult<string>> {
    const dir = join(homedir(), '.note_agent')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'mcp.json')

    let config: { servers: any[] } = { servers: [] }
    if (existsSync(configPath)) {
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (parsed && Array.isArray(parsed.servers)) config = parsed
      } catch {
        // corrupt config — start fresh rather than crash
      }
    }

    const entry: any = { name: input.name, transport: input.transport }
    if (input.command) entry.command = input.command
    if (input.args) entry.args = input.args
    if (input.url) entry.url = input.url
    if (input.env) entry.env = input.env

    const idx = config.servers.findIndex((s) => s?.name === input.name)
    if (idx >= 0) config.servers[idx] = entry
    else config.servers.push(entry)

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    return {
      data: `Registered MCP server "${input.name}" (${input.transport}) in ~/.note_agent/mcp.json. It will connect on the next agent run / app restart.`,
    }
  },

  renderToolUse(input) { return `Install MCP server: ${input.name} (${input.transport})` },
}
