/**
 * BackgroundTaskManager — long-running commands (dev servers, builds, watchers)
 * that outlive a single agent turn.
 *
 * Modeled on the PTY TerminalManager registry, but uses child_process (no native
 * deps → safe in the CLI) and a capped output buffer. Tasks are tied to a session
 * and killed when the session ends or the app quits (see agent-bridge wiring).
 */
import { spawn, type ChildProcess } from 'child_process'
import { homedir } from 'os'
import { buildShellCommand, getShellEnvFromDb } from '../../../main/shell-env'

const MAX_OUTPUT_CHARS = 100_000 // keep only the most recent ~100KB per task

export type BackgroundTaskStatus = 'running' | 'exited' | 'killed'

interface BackgroundTask {
  id: string
  sessionId: string
  command: string
  child: ChildProcess
  status: BackgroundTaskStatus
  exitCode: number | null
  output: string
  startedAt: number
}

export interface BackgroundTaskInfo {
  id: string
  command: string
  status: BackgroundTaskStatus
  exitCode: number | null
  startedAt: number
}

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private counter = 0

  start(sessionId: string, command: string, cwd: string): { id: string } {
    const id = `bg-${++this.counter}-${Date.now().toString(36)}`
    const resolved = buildShellCommand(command, cwd, getShellEnvFromDb())
    const env = {
      ...process.env,
      HOME: process.env.HOME || process.env.USERPROFILE || homedir(),
    }

    const child = spawn(resolved.file, resolved.args, {
      cwd: resolved.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const task: BackgroundTask = {
      id, sessionId, command, child,
      status: 'running', exitCode: null, output: '', startedAt: Date.now(),
    }

    const append = (chunk: Buffer) => {
      task.output += chunk.toString('utf-8')
      if (task.output.length > MAX_OUTPUT_CHARS) {
        task.output = task.output.slice(task.output.length - MAX_OUTPUT_CHARS)
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (err: Error) => {
      append(Buffer.from(`\n[spawn error: ${err.message}]`))
      if (task.status === 'running') { task.status = 'exited'; task.exitCode = 1 }
    })
    child.on('close', (code: number | null) => {
      if (task.status === 'running') { task.status = 'exited'; task.exitCode = code }
    })

    this.tasks.set(id, task)
    return { id }
  }

  read(id: string): { output: string; status: BackgroundTaskStatus; exitCode: number | null } | null {
    const t = this.tasks.get(id)
    if (!t) return null
    return { output: t.output, status: t.status, exitCode: t.exitCode }
  }

  list(sessionId: string): BackgroundTaskInfo[] {
    return [...this.tasks.values()]
      .filter((t) => t.sessionId === sessionId)
      .map((t) => ({ id: t.id, command: t.command, status: t.status, exitCode: t.exitCode, startedAt: t.startedAt }))
  }

  stop(id: string): boolean {
    const t = this.tasks.get(id)
    if (!t) return false
    this.killTask(t)
    return true
  }

  killSession(sessionId: string): void {
    for (const t of this.tasks.values()) {
      if (t.sessionId === sessionId) this.killTask(t)
    }
  }

  killAll(): void {
    for (const t of this.tasks.values()) this.killTask(t)
  }

  private killTask(t: BackgroundTask): void {
    if (t.status !== 'running' || !t.child.pid) { t.status = 'killed'; return }
    t.status = 'killed'
    // On Windows, kill the whole process tree (the shell + its children) so
    // dev servers don't orphan. Elsewhere, SIGTERM then SIGKILL.
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(t.child.pid), '/t', '/f']) } catch {}
    } else {
      try { t.child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { t.child.kill('SIGKILL') } catch {} }, 2000)
    }
  }
}

export const backgroundTasks = new BackgroundTaskManager()
