/**
 * BackgroundTaskManager — spawns real (short) processes via the shell resolver.
 */
import { describe, it, expect, afterAll } from 'bun:test'
import { backgroundTasks } from './background-task-manager'

const cwd = process.cwd()
const sid = '__bg_test_session__'

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

afterAll(() => backgroundTasks.killSession(sid))

describe('BackgroundTaskManager', () => {
  it('captures output and records exit', async () => {
    const { id } = backgroundTasks.start(sid, 'echo hello-bg', cwd)
    const done = await waitFor(() => backgroundTasks.read(id)?.status === 'exited')
    expect(done).toBe(true)
    const r = backgroundTasks.read(id)!
    expect(r.output).toContain('hello-bg')
    expect(r.exitCode).toBe(0)
  })

  it('lists tasks for the session', () => {
    expect(backgroundTasks.list(sid).length).toBeGreaterThan(0)
  })

  it('stops a running task', async () => {
    const { id } = backgroundTasks.start(sid, 'sleep 30', cwd)
    await waitFor(() => backgroundTasks.read(id)?.status === 'running', 1500)
    backgroundTasks.stop(id)
    expect(backgroundTasks.read(id)?.status).toBe('killed')
  })

  it('killSession kills the session\'s tasks', () => {
    const { id } = backgroundTasks.start(sid, 'sleep 30', cwd)
    backgroundTasks.killSession(sid)
    expect(backgroundTasks.read(id)?.status).toBe('killed')
  })

  it('read/stop return falsy for unknown ids', () => {
    expect(backgroundTasks.read('nope')).toBeNull()
    expect(backgroundTasks.stop('nope')).toBe(false)
  })
})
