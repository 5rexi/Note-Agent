/**
 * Minimal System Prompt Builder (Adaptive Engine)
 *
 * Core insight: Weak models cannot follow 3000+ token system prompts with 15+ sections.
 * We reduce to 4 sections, ~500 tokens total, with only the essential information.
 */

import type { PromptContext } from './types'
import type { TaskPlan } from '../planner/TaskPlanner'
import type { PermissionMode } from '../types'

export interface MinimalPromptContext {
  mode: PermissionMode
  workspacePath: string
  openFiles?: string[]
  fileTree?: string
  plan?: TaskPlan | null
  completedStepIds?: number[]
  todoStatus?: string
  skillsContext?: string
  builtInSkills?: string
}

/**
 * Build a minimal system prompt (~400-600 tokens) for weak models.
 * Only 4 sections: Role, Rules, Context, Plan.
 */
export function buildMinimalPrompt(ctx: MinimalPromptContext): string {
  const sections: string[] = []

  // ── Section 1: Role (~50 tokens) ──
  sections.push(`You are Note Agent. Be concise. Use tools to complete tasks.`)

  // ── Section 2: Rules (~150 tokens) ──
  const modeRule = ctx.mode === 'explore'
    ? 'EXPLORE mode: read/search only. No writes.'
    : ctx.mode === 'ask'
      ? 'ASK mode: call writeFile/editFile/executeCommand to propose changes. The system will pause for user confirmation automatically. Do NOT write text asking for permission — call the tool and let the system handle confirmation.'
      : 'EXECUTE mode: write/edit/execute directly.'

  sections.push(`## Rules
${modeRule}
- ALWAYS call tools to act. Do NOT write long text instead of using tools.
- Incomplete task? Your response MUST include at least one tool call.
- When calling tools, do NOT write explanatory text alongside them. Only output text AFTER receiving tool results or when the task is fully complete.
- Do NOT ask questions in text. ALWAYS use askUserQuestion tool to communicate questions to the user.
- If stuck or unclear, use askUserQuestion.
- When the user's request is ambiguous, has multiple valid interpretations, or involves significant consequences (deleting files, destructive edits, irreversible operations, major architectural changes), ALWAYS use askUserQuestion to confirm BEFORE acting. Do NOT guess the user's intent or make assumptions about their preferences.
- When multiple valid approaches exist, do NOT pick one arbitrarily. Use askUserQuestion to ask which approach the user prefers.
- When the task is FULLY COMPLETE, call the \`done\` tool to end the session. Do NOT read extra files "just to verify" or "just to be thorough" after finishing.
- CRITICAL: Never emit a response with zero tool calls while the task remains unfinished. The system interprets text-only responses as stalled and will abort the task.
- File paths are relative to: ${ctx.workspacePath}`)

  // ── Section 3: Context (~100-200 tokens) ──
  const contextParts: string[] = []

  if (ctx.openFiles && ctx.openFiles.length > 0) {
    const active = ctx.openFiles[ctx.openFiles.length - 1]
    const others = ctx.openFiles.slice(0, -1)
    const openList = others.length > 0
      ? `${others.join(', ')}, ${active}`
      : active
    contextParts.push(
      `Current document: ${active}\n` +
      `Also open: ${openList}\n` +
      `When the user says "this file", "current file", "the document", or "this document", they are referring to: ${active}`
    )
  }

  if (ctx.fileTree) {
    // Trim file tree to max 30 lines
    const lines = ctx.fileTree.split('\n').slice(0, 30)
    contextParts.push(`Files:\n${lines.join('\n')}`)
  }

  if (ctx.skillsContext && ctx.skillsContext.trim()) {
    contextParts.push(`Skills: ${ctx.skillsContext.split('\n')[0]}`)
  }

  if (contextParts.length > 0) {
    sections.push(`## Context\n${contextParts.join('\n\n')}`)
  }

  // ── Section 4: Plan (~0-200 tokens, only for tracked/delegated) ──
  if (ctx.plan && ctx.plan.decompose && ctx.plan.steps && ctx.plan.steps.length > 0) {
    const completedIds = ctx.completedStepIds || []
    const planLines: string[] = ['## Plan']

    for (const s of ctx.plan.steps) {
      const done = completedIds.includes(s.id) ? '✓' : '○'
      const marker = s.subagent ? ' [SA]' : ''
      planLines.push(`${done} ${s.id}. ${s.description}${marker}`)
    }

    const nextStep = ctx.plan.steps.find((s) => !completedIds.includes(s.id))
    if (nextStep) {
      planLines.push(`\n🎯 NOW: Step ${nextStep.id} — ${nextStep.description}`)
    }

    sections.push(planLines.join('\n'))
  }

  // ── Section 5: Built-in Skills (docx/pptx guidelines) ──
  if (ctx.builtInSkills && ctx.builtInSkills.trim()) {
    sections.push(ctx.builtInSkills)
  }

  // ── Section 6: Todo Status (if available) ──
  if (ctx.todoStatus && ctx.todoStatus.trim()) {
    sections.push(`## Tasks\n${ctx.todoStatus}`)
  }

  return sections.join('\n\n')
}
