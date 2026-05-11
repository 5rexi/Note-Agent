/**
 * Glue between AgentEngine and the task planner / skill loader.
 *
 * Before each user message, the engine needs to:
 *   1. Clear stale plan + todo state from prior turns
 *   2. Analyze the user's intent (planner) and create a todo list when
 *      the task is non-trivial
 *   3. Inject the right built-in skills (docx / pptx) and any workspace skills
 *   4. Build the system prompt context that the round-by-round prompt
 *      builder will reuse
 *
 * That's enough wiring that it doesn't belong inline in AgentEngine.submit().
 */
import type { LLMConfig, PermissionMode } from '../types'
import type { ToolContext } from '../tools/Tool'
import { TodoWriteTool, loadTasks, formatTasks } from '../tools/impl/todoWrite'
import {
  analyzeTask,
  createTaskPlanTodos,
  formatTaskPlan,
  loadPlan,
  clearPlan,
  getCompletedStepIds,
  type TaskPlan,
} from '../planner/TaskPlanner'
import { loadSkills, formatSkillsContext } from '../skills/loader'
import type { MinimalPromptContext } from '../prompt/minimal'
import {
  shouldInjectDocxSkill,
  DOCX_SKILL_SUMMARY,
  DOCX_SKILL_CONTENT,
} from '../skills/built-in/docx'
import {
  shouldInjectPptxSkill,
  PPTX_SKILL_SUMMARY,
} from '../skills/built-in/pptx'

export interface PrepareSessionInput {
  text: string
  llmConfig: LLMConfig
  sessionId: string | null
  workspacePath: string
  openFiles?: string[]
  mode: PermissionMode
  toolContext: ToolContext
  fileTreeSummary: string
}

export interface PreparedSession {
  taskPlan: TaskPlan | null
  persistedPlan: ReturnType<typeof loadPlan>
  minimalPromptCtx: MinimalPromptContext
}

/**
 * Run the planner, build todos, load skills, and assemble the prompt
 * context. Mutates session-scoped state (todoWrite store, plan store)
 * and returns the data the engine needs to construct system prompts.
 */
export async function prepareSession(input: PrepareSessionInput): Promise<PreparedSession> {
  const { text, llmConfig, sessionId, workspacePath, openFiles, mode, toolContext, fileTreeSummary } = input
  const sid = sessionId ?? undefined

  // Clear any stale plan/todo from previous tasks in this session
  clearPlan(sid)
  await TodoWriteTool.call({ action: 'clear' }, toolContext)

  console.log('[AgentEngine] Analyzing task:', text.slice(0, 100))
  const taskPlan = await analyzeTask(text, openFiles, llmConfig, sid)
  console.log(
    '[AgentEngine] Plan result:',
    taskPlan ? { strategy: taskPlan.strategy, steps: taskPlan.steps.length, skills: taskPlan.skills } : 'null',
  )

  if (taskPlan && taskPlan.strategy !== 'direct') {
    console.log('[AgentEngine] Creating todo list for', taskPlan.strategy, 'strategy')
    await createTaskPlanTodos(taskPlan, toolContext)
  } else {
    console.log('[AgentEngine] Direct strategy — no todo list')
  }

  const persistedPlan = loadPlan(sid)
  const todoTasks = loadTasks(sid)
  const todoStatus = todoTasks.length > 0 ? formatTasks(todoTasks) : undefined

  // Workspace-level skills (loaded from .note_agent/skills/*)
  const skills = loadSkills(workspacePath)
  const skillsContext = formatSkillsContext(skills)

  // Built-in docx/pptx skill detection (planner output OR keyword fallback)
  const needsDocx = (taskPlan && taskPlan.skills.includes('docx'))
    || shouldInjectDocxSkill(text, openFiles)
  const needsPptx = (taskPlan && taskPlan.skills.includes('pptx'))
    || shouldInjectPptxSkill(text, openFiles)

  // User skill override: if user has a skill with same id as built-in, use user's
  const userDocxSkill = skills.find((s) => s.id === 'docx')
  const userPptxSkill = skills.find((s) => s.id === 'pptx')

  const builtInSkillsParts: string[] = []
  if (needsDocx) {
    if (userDocxSkill && userDocxSkill.promptTemplate) {
      builtInSkillsParts.push(`## DOCX Skill (User Override)\n${userDocxSkill.promptTemplate}`)
    } else {
      builtInSkillsParts.push(DOCX_SKILL_CONTENT)
    }
  }
  if (needsPptx) {
    if (userPptxSkill && userPptxSkill.promptTemplate) {
      builtInSkillsParts.push(`## PPTX Skill (User Override)\n${userPptxSkill.promptTemplate}`)
    } else {
      builtInSkillsParts.push(PPTX_SKILL_SUMMARY)
    }
  }

  // Inject platform-specific shell hints on Windows
  const isWindows = process.platform === 'win32'
  if (isWindows && (needsDocx || needsPptx)) {
    builtInSkillsParts.push(`## Platform Notice (Windows)
You are running on Windows. The executeCommand tool uses cmd.exe by default.
Important differences from bash:
- Use \`mkdir\` (no \`-p\` needed)
- Use \`copy\` or \`xcopy\` instead of \`cp\`
- Use \`del\` or \`rmdir /s\` instead of \`rm\`
- Use \`move\` instead of \`mv\`
- \`&&\` works, but \`||\` and \`;\` do NOT work in cmd
- Avoid: \`unzip\`, \`zip\`, \`tar\`, \`chmod\`, \`ln\`, \`grep\`, \`sed\`, \`mkdir -p\`
- For zip operations, use the built-in \`jszip\` Node.js library via a script instead of shell commands
- For Node.js scripts: \`node script.js\` works the same on all platforms`)
  }
  // Inject research instructions when task plan has a research phase
  if (taskPlan?.phases?.some(p => p.mode === 'research')) {
    builtInSkillsParts.push(`## Research Phase Instructions
This task includes a research phase. You should:
1. Use webSearch, webFetch, browse, searchArxiv, searchSemanticScholar, and searchPubMed to gather information
2. Search in parallel when possible (use subagent for isolated searches)
3. Synthesize findings with inline citations
4. Prioritize peer-reviewed papers and authoritative sources
5. Save your research report to the workspace before proceeding to the creation phase`)
  }
  const builtInSkills = builtInSkillsParts.length > 0 ? builtInSkillsParts.join('\n\n') : undefined

  console.log('[AgentEngine] Skills injected:', {
    needsDocx,
    needsPptx,
    builtInSkillsLength: builtInSkills?.length || 0,
  })

  const minimalPromptCtx: MinimalPromptContext = {
    mode,
    workspacePath,
    openFiles,
    fileTree: fileTreeSummary,
    plan: persistedPlan,
    completedStepIds: persistedPlan ? getCompletedStepIds(todoTasks) : [],
    todoStatus,
    skillsContext,
    builtInSkills,
  }

  return { taskPlan, persistedPlan, minimalPromptCtx }
}

/** Re-export so the planner formatter doesn't have to be imported separately. */
export { formatTaskPlan, getCompletedStepIds }
