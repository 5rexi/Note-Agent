/**
 * Task 系统 — 后台任务管理
 * 参考设计文档第04/10章：TaskCreate/Get/Update/List/Stop/Output
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Lazy import sendToRenderer to avoid breaking CLI (non-Electron) environments
function sendToRendererSafe(event: string, data: unknown): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendToRenderer } = require('../../main/file-notify')
    sendToRenderer(event, data)
  } catch {
    // CLI environment — no renderer to notify
  }
}

const TASKS_DIR = join(homedir(), '.note_agent', 'bg-tasks')

export interface BackgroundTask {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  createdAt: number
  updatedAt: number
  output: string[]
  error?: string
  agentId?: string
  progress?: number // 0-100
  type?: 'latex-download' | 'latex-compile' | 'libreoffice-download' | 'agent' | 'other'
}

class TaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private runningTasks = new Set<string>()

  private ensureDir(): void {
    if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true })
  }

  create(name: string, description: string, type?: BackgroundTask['type']): BackgroundTask {
    const id = crypto.randomUUID()
    const task: BackgroundTask = {
      id,
      name,
      description,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      output: [],
      type,
    }
    this.tasks.set(id, task)
    this.saveTask(id)
    // Notify renderer that a new task was created
    sendToRendererSafe('task:created', task)
    return task
  }

  start(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'running'
    task.updatedAt = Date.now()
    this.runningTasks.add(id)
    this.saveTask(id)
  }

  appendOutput(id: string, line: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.output.push(line)
    task.updatedAt = Date.now()
    // Batch save every 10 lines
    if (task.output.length % 10 === 0) {
      this.saveTask(id)
    }
  }

  updateProgress(id: string, progress: number): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.progress = Math.max(0, Math.min(100, progress))
    task.updatedAt = Date.now()
    // Save less frequently for progress updates (every 5%)
    if (Math.floor(task.progress) % 5 === 0) {
      this.saveTask(id)
    }
  }

  complete(id: string, finalOutput?: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'completed'
    task.updatedAt = Date.now()
    if (finalOutput) task.output.push(finalOutput)
    this.runningTasks.delete(id)
    this.saveTask(id)
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'failed'
    task.error = error
    task.updatedAt = Date.now()
    this.runningTasks.delete(id)
    this.saveTask(id)
  }

  stop(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    task.status = 'stopped'
    task.updatedAt = Date.now()
    this.runningTasks.delete(id)
    this.saveTask(id)
    return true
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  list(): BackgroundTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getRunning(): BackgroundTask[] {
    return this.list().filter((t) => t.status === 'running')
  }

  saveTask(id: string): void {
    this.ensureDir()
    const task = this.tasks.get(id)
    if (task) {
      writeFileSync(join(TASKS_DIR, `${id}.json`), JSON.stringify(task, null, 2), 'utf-8')
    }
  }

  loadPersisted(): void {
    this.ensureDir()
    try {
      const files = readdirSync(TASKS_DIR)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const content = readFileSync(join(TASKS_DIR, file), 'utf-8')
          const task = JSON.parse(content) as BackgroundTask
          this.tasks.set(task.id, task)
          if (task.status === 'running' || task.status === 'pending') {
            // Mark running/pending tasks as failed on restart (they were interrupted)
            task.status = 'failed'
            task.error = 'Agent was restarted while task was running'
            this.runningTasks.delete(task.id)
            this.saveTask(task.id)
          }
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // ignore
    }
  }
}

export const taskManager = new TaskManager()
