import { execSync } from 'child_process'
import { z } from 'zod'
import { join, delimiter } from 'path'
import { homedir } from 'os'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { isDangerousCommand } from '../../utils/fs-guard'
import { buildWindowsShellCommand, getShellEnvFromDb } from '../../../main/shell-env'
import { rewritePythonCommand } from '../../../main/python-env'

// Resolve app's node_modules path so bundled packages (pptxgenjs, docx) are available
// to scripts executed in user workspaces.
import { existsSync } from 'fs'
const APP_NODE_MODULES = (() => {
  // Candidate paths where node_modules might live
  const candidates = [
    join(process.cwd(), 'node_modules'),
    join(__dirname, '..', 'node_modules'),
    join(__dirname, '..', '..', 'node_modules'),
  ]
  // Pick the first one that actually contains pptxgenjs
  for (const c of candidates) {
    if (existsSync(join(c, 'pptxgenjs', 'package.json'))) return c
  }
  return candidates[0]
})()

const inputSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
})

type Input = z.infer<typeof inputSchema>

export const ExecuteCommandTool: Tool<Input, { stdout: string; stderr: string; exitCode: number }> = {
  name: 'executeCommand',
  description: 'Execute a shell command in the workspace directory. NOTE: npm/bun/yarn/pnpm install commands are automatically routed to the .note_agent/ subdirectory to avoid polluting the workspace root with node_modules.',
  inputSchema,
  aliases: ['bash'],

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions(input, ctx) {
    if (isDangerousCommand(input.command)) {
      return { result: 'deny', reason: 'Command contains dangerous patterns' }
    }
    if (ctx.mode === 'ask') {
      return { result: 'ask', description: `Execute: ${input.command}` }
    }
    if (ctx.mode === 'explore') {
      return { result: 'deny', reason: 'Explore mode does not allow executing commands' }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<{ stdout: string; stderr: string; exitCode: number }>> {
    try {
      let execCommand = input.command
      let execOptions: any = {
        cwd: ctx.workspacePath,
        timeout: (input.timeout || 30) * 1000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env.HOME || process.env.USERPROFILE || homedir(),
          NODE_PATH: APP_NODE_MODULES + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : ''),
        },
      }

      // Prevent polluting the workspace root with node_modules.
      // Route npm/bun/yarn/pnpm install commands into .note_agent/ instead.
      const installPattern = /^\s*(npm\s+(install|i)\b|bun\s+install\b|yarn\s+(add|install)\b|pnpm\s+(add|install)\b)/
      if (installPattern.test(input.command)) {
        execOptions.cwd = join(ctx.workspacePath, '.note_agent')
        console.log(`[executeCommand] Routing install command to .note_agent: ${input.command}`)
      }

      // On Windows, route through user-selected shell env (Git Bash / WSL / native)
      if (process.platform === 'win32') {
        const shellEnv = getShellEnvFromDb()
        if (shellEnv) {
          const built = buildWindowsShellCommand(input.command, ctx.workspacePath, shellEnv)
          execCommand = built.command
          execOptions = {
            ...execOptions,
            cwd: built.options.cwd,
            shell: built.options.shell,
          }
        } else {
          execOptions.shell = true
        }
      }

      // Route python commands to workspace venv if available
      execCommand = rewritePythonCommand(execCommand, ctx.workspacePath)

      // Replace Windows-style `> nul` / `2> nul` redirects with Linux equivalents
      // to avoid creating a literal `nul` file on Linux/WSL
      execCommand = execCommand.replace(/>\s*nul\b/g, '> /dev/null').replace(/2>\s*nul\b/g, '2> /dev/null')

      const stdout = execSync(execCommand, execOptions)
      return { data: { stdout, stderr: '', exitCode: 0 } }
    } catch (err: any) {
      const stderr = err.stderr || ''
      const stdout = err.stdout || ''
      const exitCode = err.status || 1
      // Build a concise error message — avoid leaking raw shell stderr to the model
      let errorMsg = `Command failed with exit code ${exitCode}`
      if (stderr.includes('not found') || stderr.includes('No such file')) {
        errorMsg = `Command not found or not installed: "${input.command.split(' ')[0]}"`
      } else if (stderr) {
        errorMsg += `: ${stderr.slice(0, 200)}`
      } else if (err.message) {
        errorMsg += `: ${err.message.slice(0, 200)}`
      }
      return {
        data: { stdout, stderr: stderr.slice(0, 500), exitCode },
        error: errorMsg,
      }
    }
  },

  renderToolUse(input) {
    return `Execute: ${input.command}`
  },
}
