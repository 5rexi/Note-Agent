/**
 * TaskPlanner v3 — Weak-Model Compatible Task Decomposition
 *
 * 核心改进：
 * 1. 简化 schema（减少弱模型的 JSON 遵循负担）
 * 2. Few-shot 示例（比规则描述更有效）
 * 3. 低 temperature（0.3，更稳定的输出）
 * 4. Plan Mode 支持（计划持久化到文件，执行期持续注入）
 * 5. 失败安全回退（任何解析失败都不阻塞主流程）
 *
 * 设计原则来自业界最佳实践：
 * - Claude Code: 专门的 Plan Mode + 详细的工具描述
 * - Toolshed 论文: 先思考再格式化，但弱模型用一步 + few-shot 更高效
 * - 任务自适应编排: DAG 依赖关系 + 耦合度评估
 */

import type { ToolContext } from '../tools/Tool'
import { TodoWriteTool } from '../tools/impl/todoWrite'
import type { LLMConfig } from '../types'
import { createLLMClient } from '../llm/client'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ──

export type TaskComplexity = 'simple' | 'medium' | 'complex'
export type ExecutionStrategy = 'direct' | 'tracked' | 'delegated'

export interface TaskPhase {
  name: string
  mode: 'explore' | 'ask' | 'execute' | 'research'
  description?: string
}

export interface TaskPlan {
  decompose: boolean
  complexity: TaskComplexity
  strategy: ExecutionStrategy
  steps: TaskStep[]
  skills: string[]
  subagentSteps: number[]
  taskType: string
  phases?: TaskPhase[]
}

export interface TaskStep {
  id: number
  description: string
  tools?: string[]
  skills?: string[]
  subagent?: boolean
  dependsOn?: number[]
}

// ── Plan Persistence ──

const PLAN_DIR = join(homedir(), '.note_agent', 'plans')

function getPlanPath(sessionId?: string): string {
  const fileName = sessionId ? `${sessionId}.json` : 'default.json'
  return join(PLAN_DIR, fileName)
}

export function loadPlan(sessionId?: string): TaskPlan | null {
  const path = getPlanPath(sessionId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    // Validate minimal shape to prevent crashes from corrupted plan files
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) {
      return null
    }
    return normalizePlan(raw)
  } catch {
    return null
  }
}

export function savePlan(plan: TaskPlan, sessionId?: string): void {
  if (!existsSync(PLAN_DIR)) {
    mkdirSync(PLAN_DIR, { recursive: true })
  }
  writeFileSync(getPlanPath(sessionId), JSON.stringify(plan, null, 2), 'utf-8')
}

export function clearPlan(sessionId?: string): void {
  const path = getPlanPath(sessionId)
  if (existsSync(path)) {
    writeFileSync(path, '{}', 'utf-8')
  }
}

// ── Prompt Design ──

/**
 * Few-shot prompt with simplified schema.
 * Key insight from Claude Code & research: examples > rules for weak models.
 */
const PLANNER_PROMPT = `You are a task planner. Analyze the user's request and output a JSON plan.

## Task Types That Need Decomposition
- Cross-format conversion (docx→pptx, pdf→html, etc.)
- Multi-file operations (refactoring, batch processing)
- Complex analysis ("review all files", "analyze project")
- Multi-step creation (generate code + test + run)

## Task Types That Do NOT Need Decomposition
- Simple Q&A ("what is X?")
- Single file read/edit
- Quick lookup or search

## Output Format (JSON ONLY)
{
  "decompose": true or false,
  "complexity": "simple" | "medium" | "complex",
  "strategy": "direct" | "tracked" | "delegated",
  "taskType": "brief-id",
  "steps": [
    {"id": 1, "description": "concise action", "subagent": false},
    {"id": 2, "description": "concise action", "subagent": false}
  ],
  "skills": ["docx", "pptx"],
  "subagentSteps": [2]
}

## Rules
- "steps": MUST be an array. Each step MUST have "id" and "description".
- "subagent": true for steps needing isolated context (read large docs, explore many files, generate >100 lines of code).
- "skills": infer from file extensions and task type (docx, pptx, pdf, etc.).
- "subagentSteps": array of step IDs that use subagent. Empty array if none.
- "complexity": "simple" for 1-step or Q&A, "medium" for 2-3 steps, "complex" for 4+ steps or cross-format conversion.
- "strategy": "direct" for simple (no todo), "tracked" for medium (todo list), "delegated" for complex (todo + subagent).
- Keep descriptions under 80 characters.
- Do NOT put file content in descriptions — just file paths.

## Example 1: docx to pptx
User: "make a ppt from docx file ref/paper.docx"
{
  "decompose": true,
  "complexity": "complex",
  "strategy": "delegated",
  "taskType": "docx-to-pptx",
  "steps": [
    {"id": 1, "description": "Read ref/paper.docx content", "subagent": true},
    {"id": 2, "description": "Write pptxgenjs script for slides", "subagent": false},
    {"id": 3, "description": "Execute script to generate output.pptx", "subagent": false}
  ],
  "skills": ["docx", "pptx"],
  "subagentSteps": [1]
}

## Example 2: simple question
User: "what does this function do?"
{
  "decompose": false,
  "complexity": "simple",
  "strategy": "direct",
  "taskType": "simple-question",
  "steps": [],
  "skills": [],
  "subagentSteps": []
}

## Example 3: refactor across files
User: "refactor all console.log to logger.debug in src/"
{
  "decompose": true,
  "complexity": "medium",
  "strategy": "tracked",
  "taskType": "batch-refactor",
  "steps": [
    {"id": 1, "description": "Find all console.log occurrences in src/", "subagent": false},
    {"id": 2, "description": "Replace with logger.debug", "subagent": false}
  ],
  "skills": [],
  "subagentSteps": []
}

## Example 4: research then create (generic multi-phase)
User: "研究新能源政策并制作 PPT"
{
  "decompose": true,
  "complexity": "complex",
  "strategy": "delegated",
  "taskType": "multi-phase",
  "phases": [
    {"name": "research", "mode": "research", "description": "Research new energy policies"},
    {"name": "create", "mode": "execute", "description": "Generate PPT from findings"}
  ],
  "steps": [
    {"id": 1, "description": "Research current new energy policies", "subagent": true},
    {"id": 2, "description": "Synthesize findings into report", "subagent": false},
    {"id": 3, "description": "Generate PPT slides", "subagent": false}
  ],
  "skills": ["pptx"],
  "subagentSteps": [1]
}`

// ── Core Planning ──

/**
 * Analyze user request and produce a task plan.
 * Uses low temperature (0.3) for deterministic output.
 * Safe fallback: returns null on any failure.
 */
export async function analyzeTask(
  userInput: string,
  openFiles: string[] | undefined,
  llmConfig: LLMConfig,
  sessionId?: string,
): Promise<TaskPlan | null> {
  try {
    // Use lower temperature for planning (more deterministic)
    const planningConfig: LLMConfig = {
      ...llmConfig,
      temperature: 0.3,
      maxTokens: 2048,
    }

    const client = createLLMClient(planningConfig)

    const filesContext = openFiles && openFiles.length > 0
      ? `Open files: ${openFiles.join(', ')}`
      : 'No files open.'

    const messages = [
      { role: 'system' as const, content: PLANNER_PROMPT },
      {
        role: 'user' as const,
        content: `${filesContext}\n\nUser request: "${userInput}"\n\nOutput JSON plan only. No markdown, no explanation.`,
      },
    ]

    let jsonText = ''
    const stream = client.stream(messages, [])
    for await (const event of stream) {
      if (event.type === 'text') {
        jsonText += event.text
      }
    }

    // Extract JSON (handle markdown code blocks)
    const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      jsonText.match(/```\s*([\s\S]*?)\s*```/) ||
                      jsonText.match(/(\{[\s\S]*\})/)
    const cleanJson = jsonMatch ? jsonMatch[1].trim() : jsonText.trim()

    const parsed = JSON.parse(cleanJson)

    // Validate and normalize
    const plan = normalizePlan(parsed, userInput)

    // Persist plan for execution-time reminders
    if (plan.decompose) {
      savePlan(plan, sessionId)
    }

    return plan
  } catch (err: any) {
    console.error('[TaskPlanner] Planning failed:', err.message)
    return null
  }
}

/**
 * Normalize and validate raw LLM output into a TaskPlan.
 * Very permissive — fills in defaults for missing fields.
 */
function normalizePlan(raw: any, userInput?: string): TaskPlan {
  const decompose = !!raw.decompose || !!raw.shouldDecompose

  // Normalize steps
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  const steps: TaskStep[] = rawSteps.map((s: any, i: number) => ({
    id: typeof s.id === 'number' ? s.id : i + 1,
    description: String(s.description || s.desc || `Step ${i + 1}`),
    tools: Array.isArray(s.tools) || Array.isArray(s.toolsNeeded)
      ? (s.tools || s.toolsNeeded).map(String)
      : undefined,
    skills: Array.isArray(s.skills) || Array.isArray(s.skillsNeeded)
      ? (s.skills || s.skillsNeeded).map(String)
      : undefined,
    subagent: !!s.subagent || !!s.useSubagent,
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(Number) : undefined,
  }))

  // Normalize subagentSteps
  const subagentSteps = Array.isArray(raw.subagentSteps)
    ? raw.subagentSteps.map(Number)
    : steps.filter((s) => s.subagent).map((s) => s.id)

  // Normalize skills
  const skills = Array.isArray(raw.skills) || Array.isArray(raw.skillsNeeded)
    ? (raw.skills || raw.skillsNeeded).map(String)
    : []

  // Auto-infer complexity and strategy if not provided by model
  let complexity: TaskComplexity = raw.complexity || 'simple'
  let strategy: ExecutionStrategy = raw.strategy || 'direct'

  if (!raw.complexity || !raw.strategy) {
    if (!decompose || steps.length <= 1) {
      complexity = 'simple'
      strategy = 'direct'
    } else if (steps.length <= 3 && subagentSteps.length === 0) {
      complexity = 'medium'
      strategy = 'tracked'
    } else {
      complexity = 'complex'
      strategy = 'delegated'
    }
  }

  // Auto-mark reading steps as subagent for complex tasks
  if (complexity === 'complex' || complexity === 'medium') {
    for (const step of steps) {
      const desc = step.description.toLowerCase()
      if (
        (desc.includes('read') || desc.includes('extract') || desc.includes('parse')) &&
        (desc.includes('.docx') || desc.includes('.pdf') || desc.includes('.pptx') || desc.includes('document'))
      ) {
        step.subagent = true
      }
    }
  }

  // Rebuild subagentSteps after auto-marking
  const finalSubagentSteps = steps.filter((s) => s.subagent).map((s) => s.id)

  // Keyword-based research phase detection (fallback when planner doesn't emit phases)
  let phases: TaskPhase[] | undefined = raw.phases
  if (!phases && decompose) {
    const inputLower = String(userInput || '').toLowerCase()
    const researchKeywords = ['研究', '调研', '分析', '综述', 'research', 'survey', 'analyze', 'investigate']
    const creationKeywords = ['制作', '生成', '创建', '做', '写', 'create', 'make', 'generate', 'build', 'write']
    const hasResearch = researchKeywords.some(k => inputLower.includes(k))
    const hasCreation = creationKeywords.some(k => inputLower.includes(k))
    if (hasResearch && hasCreation) {
      phases = [
        { name: 'research', mode: 'research', description: 'Gather information and analyze' },
        { name: 'create', mode: 'execute', description: 'Produce output from findings' },
      ]
    } else if (hasResearch) {
      phases = [{ name: 'research', mode: 'research', description: 'Research and analyze' }]
    }
  }

  return {
    decompose,
    complexity,
    strategy,
    steps,
    skills,
    subagentSteps: finalSubagentSteps,
    taskType: String(raw.taskType || raw.type || 'unknown'),
    phases,
  }
}

// ── Helpers ──

/**
 * Auto-create todos from plan and return formatted string for system prompt.
 */
export async function createTaskPlanTodos(
  plan: TaskPlan,
  ctx: ToolContext,
): Promise<string> {
  const lines: string[] = []

  await TodoWriteTool.call({ action: 'clear' }, ctx)

  for (const step of plan.steps) {
    const label = step.subagent ? ' (via subagent)' : ''
    const result = await TodoWriteTool.call(
      { action: 'add', text: `${step.id}. ${step.description}${label}` },
      ctx,
    )
    if (result.data) {
      lines.push(String(result.data))
    }
  }

  return lines.join('\n')
}

/**
 * Format plan for system prompt injection.
 */
export function formatTaskPlan(plan: TaskPlan): string {
  if (!plan.decompose || plan.steps.length === 0) {
    return ''
  }

  const lines: string[] = [
    `## Task Plan (${plan.taskType})`,
    '',
    ...plan.steps.map((s) => {
      const marker = s.subagent ? ' [SUBAGENT]' : ''
      return `${s.id}. ${s.description}${marker}`
    }),
    '',
    `Skills: ${plan.skills.join(', ') || 'none'}`,
    `Subagent steps: ${plan.subagentSteps.length > 0 ? plan.subagentSteps.join(', ') : 'none'}`,
    '',
    'MUST follow this plan step by step. Use todoWrite to track progress.',
    'After each step, mark it complete before proceeding to the next.',
  ]

  return lines.join('\n')
}

/**
 * Infer the likely tool to use for a step based on its description.
 * Heuristic — good enough for common cases.
 */
function inferToolForStep(description: string): string | null {
  const d = description.toLowerCase()
  if (d.includes('subagent') || d.includes('delegate')) return 'subagent'
  if (d.includes('read') || d.includes('extract') || d.includes('parse') || d.includes('open ')) return 'readFile'
  if (d.includes('write') || d.includes('create') || d.includes('generate script') || d.includes('gen ')) return 'writeFile'
  if (d.includes('edit') || d.includes('replace') || d.includes('fix') || d.includes('update')) return 'editFile'
  if (d.includes('execute') || d.includes('run') || d.includes('bun ') || d.includes('node ') || d.includes('npm ')) return 'executeCommand'
  if (d.includes('search') || d.includes('find') || d.includes('grep') || d.includes('locate')) return 'grepSearch'
  if (d.includes('list') || d.includes('dir')) return 'listFiles'
  if (d.includes('ask') || d.includes('question')) return 'askUserQuestion'
  return null
}

/**
 * Format plan as an execution-time reminder.
 * Injected into system prompt every round so the model doesn't forget.
 */
export function formatPlanReminder(plan: TaskPlan, completedIds: number[]): string {
  if (!plan.decompose || plan.steps.length === 0) {
    return ''
  }

  const lines: string[] = ['## Current Plan Progress']
  for (const s of plan.steps) {
    const done = completedIds.includes(s.id) ? '✓' : '○'
    const marker = s.subagent ? ' [SA]' : ''
    lines.push(`${done} ${s.id}. ${s.description}${marker}`)
  }

  const nextStep = plan.steps.find((s) => !completedIds.includes(s.id))
  if (nextStep) {
    const tool = inferToolForStep(nextStep.description)
    const toolHint = tool ? ` → use ${tool}` : ''
    lines.push(
      '',
      `🎯 NOW: Step ${nextStep.id} — ${nextStep.description}${toolHint}`,
      '   ⚠️ Call the tool IMMEDIATELY. Do NOT write explanatory text first.',
    )
    if (nextStep.subagent) {
      lines.push('   Delegate to subagent. Task description must be <500 chars and include file paths.')
    }
  } else {
    lines.push('', 'ALL STEPS COMPLETE. Summarize results.')
  }

  return lines.join('\n')
}

/**
 * Extract completed step IDs from todo list for plan reminder.
 */
export function getCompletedStepIds(tasks: Array<{ text: string; completed: boolean }>): number[] {
  const ids: number[] = []
  for (const t of tasks) {
    if (t.completed) {
      const match = t.text.match(/^(\d+)\./)
      if (match) {
        ids.push(parseInt(match[1], 10))
      }
    }
  }
  return ids
}
