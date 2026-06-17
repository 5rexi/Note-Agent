/**
 * Skill 加载器 — 兼容 Claude Code / Cline / npx skills 通用格式
 *
 * 扫描路径：
 *   <workspace>/.note_agent/skills/  (项目级)
 *
 * 支持文件名：SKILL.md (通用) 优先于 skill.md (遗留)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { Skill } from './types'

function getProjectSkillsDir(workspacePath: string): string {
  return join(resolve(workspacePath), '.note_agent', 'skills')
}

/* ── Frontmatter parser ── */

interface ParsedFrontmatter {
  name?: string
  description?: string
  whenToUse?: string
  alwaysInject?: boolean
  body: string
}

/**
 * Parse YAML-ish frontmatter from SKILL.md.
 * Supports simple key: value, multiline |/>, and nested metadata.trigger.
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = { body: content }

  if (!content.trimStart().startsWith('---')) return result

  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return result

  const fmText = match[1]
  result.body = content.slice(match[0].length)

  const lines = fmText.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trimEnd()
    const colonIdx = line.indexOf(':')
    if (colonIdx <= 0) { i++; continue }

    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()

    // Multiline with | or > or empty first line
    if (value === '|' || value === '>' || value === '') {
      i++
      const parts: string[] = []
      while (i < lines.length) {
        const next = lines[i]
        // Stop at next top-level key (not indented)
        if (/^\w+:\s*/.test(next) && !next.startsWith(' ')) break
        parts.push(next.trim())
        i++
      }
      ;(result as any)[key] = parts.join(' ').trim()
      continue
    }

    // Check continuation lines (indented)
    i++
    const parts = [value]
    while (i < lines.length) {
      const next = lines[i]
      if (/^\w+:\s*/.test(next) && !next.startsWith(' ')) break
      if (next.startsWith('  ') || next.startsWith('\t')) {
        parts.push(next.trim())
      }
      i++
    }
    ;(result as any)[key] = parts.join(' ').trim()
  }

  // metadata.trigger
  const triggerMatch = fmText.match(/metadata:[\s\S]*?trigger:\s*(.+)/)
  if (triggerMatch) result.whenToUse = triggerMatch[1].trim()

  result.alwaysInject = fmText.includes('alwaysInject: true')
  return result
}

/* ── Skill parser ── */

function parseSkillMd(content: string, id: string, sourcePath: string): Skill {
  const { name, description, whenToUse, alwaysInject, body } = parseFrontmatter(content)

  // Universal format (Claude Code / Cline / npx skills) has name/description in frontmatter
  const isUniversal = !!name || !!description

  let finalName = name || id
  let finalDescription = description || ''
  let promptTemplate = body.trim()

  const examples: string[] = []

  if (!isUniversal) {
    // Legacy Note Agent format: parse sections manually
    const lines = body.split('\n')
    let section: 'none' | 'desc' | 'prompt' | 'examples' | 'when' = 'none'

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        finalName = trimmed.slice(2).trim()
        section = 'desc'
        continue
      }

      if (trimmed === '## Prompt' || trimmed === '## prompt') {
        section = 'prompt'
        continue
      }

      if (trimmed === '## Examples' || trimmed === '## examples') {
        section = 'examples'
        continue
      }

      if (trimmed === '## When to Use' || trimmed === '## when to use') {
        section = 'when'
        continue
      }

      if (section === 'desc') {
        finalDescription += line + '\n'
      } else if (section === 'prompt') {
        promptTemplate += line + '\n'
      } else if (section === 'examples') {
        if (trimmed) examples.push(trimmed)
      } else if (section === 'when') {
        // whenToUse in legacy frontmatter overrides body section
      }
    }

    finalDescription = finalDescription.trim()
    promptTemplate = promptTemplate.trim()
  }

  // Extract ## Examples from universal format body too
  if (isUniversal) {
    const exMatch = body.match(/^##\s+[Ee]xamples\s*\n([\s\S]*?)(?=^##\s+|\z)/m)
    if (exMatch) {
      exMatch[1].split('\n').forEach((line) => {
        const t = line.trim()
        if (t) examples.push(t)
      })
    }
  }

  return {
    id,
    name: finalName || id,
    description: finalDescription,
    promptTemplate,
    examples: examples.length > 0 ? examples : undefined,
    sourcePath,
    alwaysInject: alwaysInject ?? false,
    whenToUse: whenToUse || undefined,
  }
}

/* ── Directory scanning ── */

function loadSkillFromDir(dirPath: string, id: string): Skill | undefined {
  const skillMdUpper = join(dirPath, 'SKILL.md')
  const skillMdLower = join(dirPath, 'skill.md')

  let content = ''
  let sourcePath = ''

  if (existsSync(skillMdUpper)) {
    content = readFileSync(skillMdUpper, 'utf-8')
    sourcePath = skillMdUpper
  } else if (existsSync(skillMdLower)) {
    content = readFileSync(skillMdLower, 'utf-8')
    sourcePath = skillMdLower
  } else {
    return undefined
  }

  try {
    const skill = parseSkillMd(content, id, sourcePath)
    if (skill) {
      skill.dir = dirPath
      skill.files = listSkillFiles(dirPath)
    }
    return skill
  } catch {
    return undefined
  }
}

/** List a skill's bundled files (scripts/resources), excluding SKILL.md itself. */
function listSkillFiles(dirPath: string, prefix = '', depth = 0): string[] {
  if (depth > 3) return []
  const out: string[] = []
  try {
    for (const entry of readdirSync(dirPath)) {
      if (entry.startsWith('.')) continue
      const full = join(dirPath, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      const st = statSync(full)
      if (st.isDirectory()) {
        out.push(...listSkillFiles(full, rel, depth + 1))
      } else if (!/^skill\.md$/i.test(entry)) {
        out.push(rel)
      }
    }
  } catch { /* ignore */ }
  return out
}

function scanSkillsDir(dirPath: string): Skill[] {
  if (!existsSync(dirPath)) return []

  const skills: Skill[] = []
  try {
    const entries = readdirSync(dirPath)
    for (const entry of entries) {
      const fullPath = join(dirPath, entry)
      if (statSync(fullPath).isDirectory()) {
        const skill = loadSkillFromDir(fullPath, entry)
        if (skill) skills.push(skill)
      }
    }
  } catch {
    // ignore
  }
  return skills
}

/* ── Public API ── */

/**
 * 加载所有可用 skills（用户级多目录 + 项目级）
 * 后加载的覆盖先加载的同名 skill
 */
export function loadSkills(workspacePath: string): Skill[] {
  return scanSkillsDir(getProjectSkillsDir(workspacePath))
}

/**
 * 获取 skill 列表（不含完整 promptTemplate，用于 UI 展示）
 */
export function getSkillList(workspacePath: string): Array<{ id: string; name: string; description: string; alwaysInject: boolean }> {
  return loadSkills(workspacePath).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    alwaysInject: s.alwaysInject ?? false,
  }))
}

/**
 * 将 skills 格式化为 system prompt 可用的字符串
 */
export function formatSkillsContext(skills: Skill[]): string | undefined {
  if (skills.length === 0) return undefined

  const parts: string[] = ['## Available Skills']

  for (const skill of skills) {
    parts.push(`\n### ${skill.name} (${skill.id})`)
    parts.push(skill.description)
    if (skill.whenToUse) {
      parts.push(`**When to use:** ${skill.whenToUse}`)
    }
    if (skill.examples) {
      parts.push('\n**Examples:**')
      for (const ex of skill.examples) {
        parts.push(`- ${ex}`)
      }
    }
    if (skill.alwaysInject && skill.promptTemplate) {
      parts.push('\n**Active Guidelines (always apply):**')
      parts.push(skill.promptTemplate)
      parts.push(formatSkillResources(skill))
    } else if (skill.files && skill.files.length > 0) {
      parts.push(`_(ships ${skill.files.length} bundled file(s); activate to use)_`)
    }
  }

  return parts.join('\n')
}

/**
 * 获取单个 skill 的完整 prompt（用于 SkillTool 调用）
 */
export function getSkillPrompt(skill: Skill, context?: Record<string, string>): string {
  let prompt = skill.promptTemplate

  if (context) {
    for (const [key, val] of Object.entries(context)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    }
  }

  prompt += formatSkillResources(skill)
  return prompt
}

/**
 * Tell the model where the skill's bundled files live so it can read/run them
 * (scripts via executeCommand, resources via readFile). This is what lets a
 * skill ship runnable scripts, not just instructions.
 */
export function formatSkillResources(skill: Skill): string {
  if (!skill.dir || !skill.files || skill.files.length === 0) return ''
  const scripts = skill.files.filter((f) => /\.(py|js|cjs|mjs|sh|ps1|rb|ts)$/i.test(f))
  const lines = [`\n\n## Skill files (in ${skill.dir})`]
  lines.push('This skill ships bundled files. Reference them by their path inside the skill directory above.')
  for (const f of skill.files) lines.push(`- ${f}`)
  if (scripts.length > 0) {
    lines.push('To run a bundled script, call executeCommand with its full path, e.g.:')
    lines.push(`  python "${skill.dir}/${scripts[0]}"   (or node / bash as appropriate)`)
  }
  return lines.join('\n')
}
