/**
 * SkillTool — 让模型调用特定 Skill
 *
 * 模型通过此工具获取 Skill 的完整 prompt 模板，
 * 然后在自己的回复中应用该模板。
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../tools/Tool'
import type { ToolResult } from '../types'
import { loadSkills, getSkillPrompt } from './loader'

const inputSchema = z.object({
  skillId: z.string().describe('The ID of the skill to invoke (e.g., "code-review", "refactor")'),
  context: z.record(z.string(), z.string()).optional().describe('Optional context variables for the skill template'),
})

type Input = z.infer<typeof inputSchema>

export const SkillTool: Tool<Input, string> = {
  name: 'skill',
  description: 'Invoke a loaded skill by its ID. Skills are loaded ONLY from the workspace `.note_agent/skills/` directory. If a skill is not found, it means it was NOT installed to the correct location. Use this when you need to apply a specific skill\'s expertise or workflow.',
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx): Promise<ToolResult<string>> {
    const skills = loadSkills(ctx.workspacePath)
    const skill = skills.find((s) => s.id === input.skillId)

    if (!skill) {
      const available = skills.map((s) => `${s.id} (${s.name})`).join(', ')
      return {
        data: '',
        error: `Skill '${input.skillId}' not found. Available: ${available || 'none'}`,
      }
    }

    const prompt = getSkillPrompt(skill, input.context as Record<string, string> | undefined)

    return {
      data: `## Skill: ${skill.name}\n\n${skill.description}\n\n---\n\n${prompt}`,
    }
  },

  renderToolUse(input) {
    return `Invoke skill: ${input.skillId}`
  },
}
