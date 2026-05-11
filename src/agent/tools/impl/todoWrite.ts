/**
 * TodoWriteTool — 任务列表管理
 *
 * 读写本地 JSON 任务文件：~/.note_agent/tasks/<sessionId>.json
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const inputSchema = z.object({
  action: z.enum(['list', 'add', 'complete', 'remove', 'clear']).describe('Action to perform'),
  text: z.string().optional().describe('Task text (for add)'),
  index: z.number().int().optional().describe('Task index (for complete/remove)'),
})

type Input = z.infer<typeof inputSchema>

interface Task {
  text: string
  completed: boolean
  createdAt: string
}

const TASKS_DIR = join(homedir(), '.note_agent', 'tasks')

function getTasksPath(sessionId?: string): string {
  const fileName = sessionId ? `${sessionId}.json` : 'default.json'
  return join(TASKS_DIR, fileName)
}

export function loadTasks(sessionId?: string): Task[] {
  const path = getTasksPath(sessionId)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Task[]
  } catch {
    return []
  }
}

export function saveTasks(tasks: Task[], sessionId?: string): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true })
  }
  writeFileSync(getTasksPath(sessionId), JSON.stringify(tasks, null, 2), 'utf-8')
}

export function formatTasks(tasks: Task[]): string {
  if (tasks.length === 0) return 'No tasks.'
  const lines = tasks.map((t, i) => `${i + 1}. [${t.completed ? 'x' : ' '}] ${t.text}`)
  const completed = tasks.filter((t) => t.completed).length
  const total = tasks.length
  lines.push(`\nProgress: ${completed}/${total} completed (${Math.round((completed / total) * 100)}%)`)
  return lines.join('\n')
}

export const TodoWriteTool: Tool<Input, string> = {
  name: 'todoWrite',
  description: `Manage a todo list for tracking multi-step tasks. This is your PRIMARY tool for organizing work.

## When to Use
- ALWAYS use todoWrite at the START of any multi-step task (more than 2 steps)
- Use it to break down complex requests into concrete, actionable steps
- Update the list after completing EACH sub-task

## Actions
- list: Show all tasks and progress
- add: Create a new task with descriptive text
- complete: Mark a task as done (index is 1-based: first item = 1)
- remove: Delete a task by index
- clear: Remove all tasks (use sparingly)

## Best Practices
- Create the FULL task list BEFORE starting any work
- Each task should be concrete: "Read docx file" NOT "Do research"
- After finishing a sub-task, immediately mark it complete
- If a task fails, do NOT remove it — mark it complete and add a follow-up task
- Keep task descriptions under 80 characters

## Example Workflow
1. todoWrite add "Read source document"
2. todoWrite add "Analyze structure and extract key points"
3. todoWrite add "Generate output file"
4. (do the work for step 1)
5. todoWrite complete 1
6. (do the work for step 2)
7. todoWrite complete 2

## Common Mistakes to Avoid
- Do NOT add tasks one at a time as you go — plan the full list upfront
- Do NOT forget to mark tasks complete — the list is your memory
- Do NOT include file content in task text — just file paths`,
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx): Promise<ToolResult<string>> {
    const tasks = loadTasks(ctx.sessionId) // Use sessionId as task file key

    switch (input.action) {
      case 'list': {
        return { data: formatTasks(tasks) }
      }

      case 'add': {
        if (!input.text) {
          return { data: '', error: 'Task text is required for add action' }
        }
        // Prevent duplicate tasks (same text, case-insensitive, ignoring step number prefix)
        const normalizeTask = (text: string) => text.trim().toLowerCase().replace(/^\d+\.\s*/, '')
        const normalized = normalizeTask(input.text)
        const exists = tasks.some((t) => normalizeTask(t.text) === normalized)
        if (exists) {
          return { data: `Task already exists: "${input.text}"\n\n${formatTasks(tasks)}` }
        }
        tasks.push({ text: input.text, completed: false, createdAt: new Date().toISOString() })
        saveTasks(tasks, ctx.sessionId)
        return { data: `Added: ${input.text}\n\n${formatTasks(tasks)}` }
      }

      case 'complete': {
        if (input.index === undefined) {
          return { data: '', error: 'Task index is required for complete action' }
        }
        const idx = input.index - 1
        if (idx < 0 || idx >= tasks.length) {
          return { data: '', error: `Invalid task index: ${input.index}` }
        }
        tasks[idx].completed = true
        saveTasks(tasks, ctx.sessionId)
        return { data: `Completed: ${tasks[idx].text}\n\n${formatTasks(tasks)}` }
      }

      case 'remove': {
        if (input.index === undefined) {
          return { data: '', error: 'Task index is required for remove action' }
        }
        const idx = input.index - 1
        if (idx < 0 || idx >= tasks.length) {
          return { data: '', error: `Invalid task index: ${input.index}` }
        }
        const removed = tasks.splice(idx, 1)[0]
        saveTasks(tasks, ctx.sessionId)
        return { data: `Removed: ${removed.text}\n\n${formatTasks(tasks)}` }
      }

      case 'clear': {
        saveTasks([], ctx.sessionId)
        return { data: 'All tasks cleared.' }
      }

      default:
        return { data: '', error: `Unknown action: ${input.action}` }
    }
  },

  renderToolUse(input) {
    return `Todo ${input.action}${input.text ? `: ${input.text}` : ''}`
  },
}
