/**
 * Skill 加载器 — 扫描 ~/.note_agent/skills/ 和项目级 .note_agent/skills/
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { Skill } from './types'

const USER_SKILLS_DIR = join(homedir(), '.note_agent', 'skills')

function getProjectSkillsDir(workspacePath: string): string {
  return join(resolve(workspacePath), '.note_agent', 'skills')
}

/**
 * 解析 skill.md 文件
 * 格式：
 *   # Skill Name
 *   Description line...
 *   ## Prompt
 *   prompt template...
 *   ## Examples
 *   example 1...
 */
function parseSkillMd(content: string, id: string, sourcePath: string): Skill {
  const lines = content.split('\n')
  let name = id
  let description = ''
  let promptTemplate = ''
  let alwaysInject = false
  let whenToUse = ''
  const examples: string[] = []

  let section: 'none' | 'desc' | 'prompt' | 'examples' | 'when' = 'none'
  let inFrontmatter = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Frontmatter: --- ... ---
    if (trimmed === '---' && i === 0) {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false
        continue
      }
      if (trimmed.startsWith('alwaysInject:')) {
        alwaysInject = trimmed.includes('true')
      }
      if (trimmed.startsWith('whenToUse:')) {
        whenToUse = trimmed.slice('whenToUse:'.length).trim()
      }
      continue
    }

    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      name = trimmed.slice(2).trim()
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
      description += line + '\n'
    } else if (section === 'prompt') {
      promptTemplate += line + '\n'
    } else if (section === 'examples') {
      if (trimmed) examples.push(trimmed)
    } else if (section === 'when') {
      whenToUse += line + '\n'
    }
  }

  return {
    id,
    name,
    description: description.trim(),
    promptTemplate: promptTemplate.trim(),
    examples: examples.length > 0 ? examples : undefined,
    sourcePath,
    alwaysInject,
    whenToUse: whenToUse.trim() || undefined,
  }
}

/**
 * 从单个目录加载 skill
 */
function loadSkillFromDir(dirPath: string, id: string): Skill | undefined {
  const skillMdPath = join(dirPath, 'skill.md')
  if (!existsSync(skillMdPath)) return undefined

  try {
    const content = readFileSync(skillMdPath, 'utf-8')
    return parseSkillMd(content, id, dirPath)
  } catch {
    return undefined
  }
}

/**
 * 扫描 skills 目录，返回所有 skill
 */
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

/**
 * 加载所有可用 skills（用户级 + 项目级）
 * 项目级覆盖用户级同名 skill
 */
export function loadSkills(workspacePath: string): Skill[] {
  const userSkills = scanSkillsDir(USER_SKILLS_DIR)
  const projectSkills = scanSkillsDir(getProjectSkillsDir(workspacePath))

  const map = new Map<string, Skill>()
  for (const s of userSkills) map.set(s.id, s)
  for (const s of projectSkills) map.set(s.id, s) // Override

  return Array.from(map.values())
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
 * alwaysInject skills 的完整内容也会被包含
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
    }
  }

  return parts.join('\n')
}

/**
 * 获取单个 skill 的完整 prompt（用于 SkillTool 调用）
 */
export function getSkillPrompt(skill: Skill, context?: Record<string, string>): string {
  let prompt = skill.promptTemplate

  // Simple template substitution: {{key}} → value
  if (context) {
    for (const [key, val] of Object.entries(context)) {
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    }
  }

  return prompt
}
