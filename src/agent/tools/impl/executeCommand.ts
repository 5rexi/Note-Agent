import { spawn } from 'child_process'
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
  description: (() => {
    const isWin = process.platform === 'win32'
    const shellInfo = isWin
      ? 'Current platform: Windows. Use cmd/PowerShell syntax. mkdir works without -p. Use forward slashes (/) or escaped backslashes (\\\\) in paths. Avoid bash-specific syntax.'
      : 'Current platform: Unix-like. Standard bash syntax applies.'
    return 'Execute a shell command in the workspace directory. ' + shellInfo + ' NOTE: npm/bun/yarn/pnpm install commands are automatically routed to the .note_agent/ subdirectory to avoid polluting the workspace root with node_modules.'
  })(),
  inputSchema,
  aliases: ['bash'],

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

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
    const MAX_OUTPUT_SIZE = 10 * 1024 * 1024 // 10 MB
    const MAX_TIMEOUT_SECONDS = 300 // 5 minutes hard cap

    const timeoutSec = Math.min(input.timeout || 30, MAX_TIMEOUT_SECONDS)

    return new Promise((resolve) => {
      let execCommand = input.command
      const execOptions: any = {
        cwd: ctx.workspacePath,
        env: {
          ...process.env,
          HOME: process.env.HOME || process.env.USERPROFILE || homedir(),
          NODE_PATH: APP_NODE_MODULES + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : ''),
        },
      }

      // Prevent polluting the workspace root with node_modules.
      const installPattern = /^\s*(npm\s+(install|i)\b|bun\s+install\b|yarn\s+(add|install)\b|pnpm\s+(add|install)\b)/
      if (installPattern.test(input.command)) {
        execOptions.cwd = join(ctx.workspacePath, '.note_agent')
      }

      // On Windows, route through user-selected shell env
      if (process.platform === 'win32') {
        const shellEnv = getShellEnvFromDb()
        if (shellEnv) {
          const built = buildWindowsShellCommand(input.command, ctx.workspacePath, shellEnv)
          execCommand = built.command
          execOptions.cwd = built.options.cwd
          execOptions.shell = built.options.shell
        } else {
          execOptions.shell = true
        }
      }

      // Route python commands to workspace venv if available
      execCommand = rewritePythonCommand(execCommand, ctx.workspacePath)

      // Replace Windows-style redirects
      execCommand = execCommand.replace(/>\s*nul\b/g, '> /dev/null').replace(/2>\s*nul\b/g, '2> /dev/null')

      let stdout = ''
      let stderr = ''
      let killed = false

      const child = spawn(execCommand, [], {
        ...execOptions,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const timeoutId = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        // Force kill after 5s if still running
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)
      }, timeoutSec * 1000)

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > MAX_OUTPUT_SIZE) {
          stdout += chunk.slice(0, MAX_OUTPUT_SIZE - stdout.length).toString('utf-8')
          if (!killed) {
            killed = true
            child.kill('SIGTERM')
          }
        } else {
          stdout += chunk.toString('utf-8')
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length + chunk.length > MAX_OUTPUT_SIZE) {
          stderr += chunk.slice(0, MAX_OUTPUT_SIZE - stderr.length).toString('utf-8')
        } else {
          stderr += chunk.toString('utf-8')
        }
      })

      child.on('error', (err: any) => {
        clearTimeout(timeoutId)
        let errorMsg = `Command failed: ${err.message || 'Unknown error'}`
        if (err.code === 'ENOENT') {
          errorMsg = `Command not found or not installed: "${input.command.split(' ')[0]}"`
        }
        resolve({
          data: { stdout, stderr: stderr.slice(0, 500), exitCode: 1 },
          error: errorMsg,
        })
      })

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId)
        const exitCode = code ?? (killed ? 124 : 1)

        if (exitCode === 0 && !killed) {
          resolve({ data: { stdout, stderr: stderr.slice(0, 500), exitCode: 0 } })
          return
        }

        let errorMsg = `Command failed with exit code ${exitCode}`
        if (killed && code === null) {
          errorMsg = timeoutSec >= MAX_TIMEOUT_SECONDS
            ? `Command timed out after ${timeoutSec}s (hard limit reached)`
            : `Command timed out after ${timeoutSec}s`
        } else if (stderr.includes('not found') || stderr.includes('No such file') || stderr.includes('is not recognized')) {
          errorMsg = `Command not found or not installed: "${input.command.split(' ')[0]}"`
        } else if (stderr) {
          errorMsg += `: ${stderr.slice(0, 200)}`
        }
        resolve({
          data: { stdout, stderr: stderr.slice(0, 500), exitCode },
          error: errorMsg,
        })
      })
    })
  },

  renderToolUse(input) {
    return `Execute: ${input.command}`
  },
}
