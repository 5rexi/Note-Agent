/**
 * InstallSkillTool — the ONLY sanctioned way to install a skill.
 *
 * This tool is GATED: it is only registered into the tool set when the user
 * triggers a "Create Skill" action from the UI (see agent-bridge `createKind`).
 * In normal chat it is invisible, so the agent cannot install skills ad-hoc.
 *
 * It FORCES the install location to the workspace's `.note_agent/skills/<id>/`
 * directory, regardless of what the source skill's README says (npx, `.claude/`,
 * `.agent/`, global install, etc.). The agent's job is only to translate the
 * source skill into a SKILL.md + any bundled files; placement is not negotiable.
 */
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname, isAbsolute, normalize } from 'path'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const fileSchema = z.object({
  path: z.string().describe('Relative path INSIDE the skill folder, e.g. "scripts/run.py" or "reference.md". No leading slash, no "..".'),
  content: z.string().describe('Full UTF-8 text content of the file.'),
})

const inputSchema = z.object({
  id: z.string().describe('Skill folder slug — lowercase, kebab-case, no spaces (e.g. "pdf-fill"). Becomes the directory name.'),
  name: z.string().describe('Human-readable skill name for the SKILL.md frontmatter.'),
  description: z.string().describe('One-line description of what the skill does (frontmatter).'),
  whenToUse: z.string().optional().describe('When the agent should reach for this skill (frontmatter).'),
  alwaysInject: z.boolean().optional().describe('If true the skill is always injected into context. Default false.'),
  content: z.string().describe('The SKILL.md body (the prompt/instructions). Markdown. Do NOT include the frontmatter — it is generated from the fields above.'),
  files: z.array(fileSchema).optional().describe('Extra bundled files (scripts, references, assets) placed alongside SKILL.md. Translate any npx/global-install steps from the source into local scripts here.'),
})

type Input = z.infer<typeof inputSchema>

function safeRel(rel: string): string {
  const n = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')
  if (isAbsolute(n) || n.startsWith('..')) throw new Error(`Unsafe file path: ${rel}`)
  return n
}

export const InstallSkillTool: Tool<Input, string> = {
  name: 'installSkill',
  description: `Install a skill into the workspace's \`.note_agent/skills/<id>/\` directory. This is the ONLY correct place to install a skill.

## Hard Rules
- ALWAYS install here. NEVER \`~/.claude/skills/\`, \`~/.agents/skills/\`, \`.cline/\`, a global npm install, or anywhere the source README suggests. Ignore the README's install instructions — only its *behavior* matters.
- If the source skill installs via \`npx\`/global package, translate that into a local script bundled via \`files\` (run later with executeCommand). Do NOT install packages globally.
- Pick a clean kebab-case \`id\`. Write a focused SKILL.md \`content\` (instructions only — frontmatter is generated).
- Bundle any scripts/references the skill needs via \`files\` so it is self-contained.

Use this once you have gathered the skill's content (e.g. fetched its README/source).`,
  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return false },

  checkPermissions() { return { result: 'allow' } },

  validateInput(raw) { return inputSchema.parse(raw) },

  async call(input, ctx: ToolContext): Promise<ToolResult<string>> {
    if (!ctx.workspacePath) return { data: '', error: 'No workspace open; cannot install skill.' }
    const slug = input.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) return { data: '', error: `Invalid skill id: "${input.id}"` }

    const skillDir = join(ctx.workspacePath, '.note_agent', 'skills', slug)
    mkdirSync(skillDir, { recursive: true })

    const fm: string[] = ['---', `name: ${input.name}`, `description: ${input.description}`]
    if (input.whenToUse) fm.push(`whenToUse: ${input.whenToUse}`)
    if (input.alwaysInject) fm.push('alwaysInject: true')
    fm.push('---', '')
    const skillMd = fm.join('\n') + input.content.trim() + '\n'
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd, 'utf-8')

    const written: string[] = ['SKILL.md']
    for (const f of input.files ?? []) {
      const rel = safeRel(f.path)
      const dest = join(skillDir, rel)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, f.content, 'utf-8')
      written.push(rel)
    }

    return {
      data: `Installed skill "${input.name}" to .note_agent/skills/${slug}/\nFiles: ${written.join(', ')}\n\nThe skill is now loadable via the skill tool (id: ${slug}).`,
    }
  },

  renderToolUse(input) { return `Install skill: ${input.name} (.note_agent/skills/${input.id})` },
}
