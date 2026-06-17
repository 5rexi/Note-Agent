import { spawn } from 'child_process'
import { z } from 'zod'
import { join, delimiter } from 'path'
import { homedir } from 'os'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { isDangerousCommand } from '../../utils/fs-guard'
import { buildShellCommand, getShellEnvFromDb, resolveDefaultShell, isBashLikeShell } from '../../../main/shell-env'
import { rewritePythonCommand } from '../../../main/python-env'

// Resolve app's node_modules path so bundled packages (pptxgenjs, docx) are available
// to scripts executed in user workspaces.
import { existsSync } from 'fs'
const APP_NODE_MODULES = (() => {
  // Candidate paths where node_modules might live. In a packaged app the script
  // packages are inside app.asar, which a spawned `node` child process CANNOT
  // require from — they must be the UNPACKED copies (app.asar.unpacked/...).
  // So prefer the .unpacked path (electron's fs makes existsSync true for both).
  const unpack = (p: string) => p.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
  const bases = [
    join(__dirname, '..', 'node_modules'),
    join(__dirname, '..', '..', 'node_modules'),
    join(process.cwd(), 'node_modules'),
  ]
  const candidates = [...bases.map(unpack), ...bases]
  // Pick the first one that actually contains pptxgenjs.
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
  // Getter so the guidance tracks the user's CURRENT terminal choice (Settings →
  // can change at runtime). The configured shell decides cmd vs unix syntax.
  get description() {
    let cfg = getShellEnvFromDb() || resolveDefaultShell()
    if ((cfg.type as string) === 'native') cfg = { type: 'cmd' }
    const bashLike = isBashLikeShell(cfg.type)
    const shellInfo = bashLike
      ? `The configured terminal is **${cfg.type}** — a Unix/bash-like shell. Use UNIX commands (\`cp\`, \`mv\`, \`rm\`, \`ls\`, \`mkdir -p\`) and forward-slash paths. Do NOT use Windows cmd built-ins (\`copy\`/\`move\`/\`del\`) — they FAIL here.`
      : `The configured terminal is **${cfg.type}** (Windows ${cfg.type === 'powershell' ? 'PowerShell' : 'cmd'}). Use Windows commands (\`copy\`, \`move\`, \`del\`, \`mkdir\` without -p). Do NOT use Unix-only commands (\`cp\`, \`rm\`, \`ls\`) — prefer ${cfg.type === 'powershell' ? 'PowerShell cmdlets (Copy-Item, Remove-Item)' : 'cmd built-ins'}.`
    return 'Execute a shell command in the workspace directory. ' + shellInfo + ' Tip: scripts can write output DIRECTLY to the final path (e.g. relative `../../output.pptx`) to avoid a copy step. NOTE: npm/bun/yarn/pnpm install commands are automatically routed to the .note_agent/ subdirectory to avoid polluting the workspace root with node_modules.'
  },
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
      const env = {
        ...process.env,
        HOME: process.env.HOME || process.env.USERPROFILE || homedir(),
        NODE_PATH: APP_NODE_MODULES + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : ''),
      }

      // Prevent polluting the workspace root with node_modules.
      const installPattern = /^\s*(npm\s+(install|i)\b|bun\s+install\b|yarn\s+(add|install)\b|pnpm\s+(add|install)\b)/
      const cwd = installPattern.test(input.command)
        ? join(ctx.workspacePath, '.note_agent')
        : ctx.workspacePath

      // Route python commands to the workspace venv if available.
      const rawCommand = rewritePythonCommand(input.command, ctx.workspacePath)

      // Resolve the user-configured shell (or platform default) into an explicit
      // spawn invocation. Works on every OS — the old code only set a shell on
      // Windows, so Unix commands with args/pipes failed to run at all.
      const resolved = buildShellCommand(rawCommand, cwd, getShellEnvFromDb())

      // Only rewrite Windows-style `nul` redirects when running under bash.
      const args = resolved.bashLike
        ? resolved.args.map((a) => a.replace(/>\s*nul\b/g, '> /dev/null').replace(/2>\s*nul\b/g, '2> /dev/null'))
        : resolved.args

      let stdout = ''
      let stderr = ''
      let killed = false

      const child = spawn(resolved.file, args, {
        cwd: resolved.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const timeoutId = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        // Force kill after 5s if still running
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)
      }, timeoutSec * 1000)

      // Kill the process if the user cancels the turn.
      const onAbort = () => {
        killed = true
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
      }
      if (ctx.signal) {
        if (ctx.signal.aborted) onAbort()
        else ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
      const cleanupAbort = () => ctx.signal?.removeEventListener('abort', onAbort)

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
        cleanupAbort()
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
        cleanupAbort()
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
