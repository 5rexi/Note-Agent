/**
 * Background task tools — start/list/read/stop long-running commands that
 * outlive a single agent turn (dev servers, builds, watchers, training runs).
 *
 * Use these instead of executeCommand when a command should keep running while
 * you do other work. executeCommand stays for short, blocking commands.
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { isDangerousCommand } from '../../utils/fs-guard'
import { backgroundTasks } from './background-task-manager'

// ── startBackgroundTask ──

const startSchema = z.object({
  command: z.string().describe('Shell command to run in the background (e.g. "npm run dev").'),
})
type StartInput = z.infer<typeof startSchema>

export const StartBackgroundTaskTool: Tool<StartInput, { id: string }> = {
  name: 'startBackgroundTask',
  description: 'Start a long-running command in the background (dev server, build watcher, etc.) and return a task id immediately. Poll its output with readBackgroundTask and stop it with stopBackgroundTask. Use executeCommand for short commands that finish quickly.',
  inputSchema: startSchema,
  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },
  checkPermissions(input, ctx) {
    if (isDangerousCommand(input.command)) return { result: 'deny', reason: 'Command contains dangerous patterns' }
    if (ctx.mode === 'explore') return { result: 'deny', reason: 'Explore mode does not allow running commands' }
    if (ctx.mode === 'ask') return { result: 'ask', description: `Run in background: ${input.command}` }
    return { result: 'allow' }
  },
  validateInput(raw) { return startSchema.parse(raw) },
  async call(input, ctx: ToolContext): Promise<ToolResult<{ id: string }>> {
    const { id } = backgroundTasks.start(ctx.sessionId ?? 'default', input.command, ctx.workspacePath)
    return { data: { id } }
  },
  renderToolUse(input) { return `Background: ${input.command}` },
}

// ── listBackgroundTasks ──

const emptySchema = z.object({})

export const ListBackgroundTasksTool: Tool<Record<string, never>, unknown> = {
  name: 'listBackgroundTasks',
  description: 'List background tasks for this session with their status (running/exited/killed).',
  inputSchema: emptySchema,
  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },
  checkPermissions() { return { result: 'allow' } },
  validateInput(raw) { return emptySchema.parse(raw) },
  async call(_input, ctx: ToolContext): Promise<ToolResult<unknown>> {
    return { data: backgroundTasks.list(ctx.sessionId ?? 'default') }
  },
  renderToolUse() { return 'List background tasks' },
}

// ── readBackgroundTask ──

const idSchema = z.object({
  id: z.string().describe('The background task id returned by startBackgroundTask.'),
})
type IdInput = z.infer<typeof idSchema>

export const ReadBackgroundTaskTool: Tool<IdInput, unknown> = {
  name: 'readBackgroundTask',
  description: "Read the recent output and status of a background task. Output is the most recent ~100KB.",
  inputSchema: idSchema,
  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },
  checkPermissions() { return { result: 'allow' } },
  validateInput(raw) { return idSchema.parse(raw) },
  async call(input, _ctx): Promise<ToolResult<unknown>> {
    const r = backgroundTasks.read(input.id)
    if (!r) return { data: '', error: `No background task with id "${input.id}"` }
    return { data: r }
  },
  renderToolUse(input) { return `Read background task ${input.id}` },
}

// ── stopBackgroundTask ──

export const StopBackgroundTaskTool: Tool<IdInput, string> = {
  name: 'stopBackgroundTask',
  description: 'Stop (kill) a running background task by id.',
  inputSchema: idSchema,
  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },
  checkPermissions() { return { result: 'allow' } },
  validateInput(raw) { return idSchema.parse(raw) },
  async call(input, _ctx): Promise<ToolResult<string>> {
    const ok = backgroundTasks.stop(input.id)
    return ok ? { data: `Stopped ${input.id}` } : { data: '', error: `No background task with id "${input.id}"` }
  },
  renderToolUse(input) { return `Stop background task ${input.id}` },
}
