/**
 * Skill 加载器测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { loadSkills, formatSkillsContext, getSkillPrompt } from './loader'

const TEST_WS = join(process.cwd(), 'test-workspace-skills')
const TEST_SKILLS_DIR = join(TEST_WS, '.note_agent', 'skills')
const ORIGINAL_SKILLS_HOME = process.env.NOTE_AGENT_SKILLS_HOME

describe('loadSkills', () => {
  beforeEach(() => {
    // Isolate from real user skill directories during tests
    process.env.NOTE_AGENT_SKILLS_HOME = TEST_WS
    if (!existsSync(TEST_SKILLS_DIR)) {
      mkdirSync(TEST_SKILLS_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    process.env.NOTE_AGENT_SKILLS_HOME = ORIGINAL_SKILLS_HOME
    if (existsSync(TEST_WS)) {
      rmSync(TEST_WS, { recursive: true, force: true })
    }
  })

  it('should return empty array when no skills exist', () => {
    const skills = loadSkills(TEST_WS)
    expect(skills).toEqual([])
  })

  it('should load a skill from skill.md', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'code-review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'skill.md'),
      '# Code Review\n\nReview code for bugs and style issues.\n\n## Prompt\n\nReview this code:\n\n```\n{{code}}\n```\n\n## Examples\n\nCheck for null pointers\nEnsure consistent naming',
      'utf-8',
    )

    const skills = loadSkills(TEST_WS)
    expect(skills.length).toBe(1)
    expect(skills[0].id).toBe('code-review')
    expect(skills[0].name).toBe('Code Review')
    expect(skills[0].description).toContain('Review code')
    expect(skills[0].promptTemplate).toContain('{{code}}')
    expect(skills[0].examples).toEqual(['Check for null pointers', 'Ensure consistent naming'])
  })

  it('should parse alwaysInject from frontmatter', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'style-guide')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'skill.md'),
      '---\nalwaysInject: true\nwhenToUse: When writing code\n---\n# Style Guide\n\nUse 2-space indentation.\n\n## Prompt\n\nAlways indent with 2 spaces.',
      'utf-8',
    )

    const skills = loadSkills(TEST_WS)
    const skill = skills.find((s) => s.id === 'style-guide')
    expect(skill).toBeDefined()
    expect(skill!.alwaysInject).toBe(true)
    expect(skill!.whenToUse).toBe('When writing code')
    expect(skill!.promptTemplate).toContain('2 spaces')
  })

  it('should load multiple skills', () => {
    for (const name of ['skill-a', 'skill-b']) {
      const dir = join(TEST_SKILLS_DIR, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'skill.md'), `# ${name}\n\nDesc\n\n## Prompt\n\nPrompt`, 'utf-8')
    }

    const skills = loadSkills(TEST_WS)
    expect(skills.length).toBe(2)
    expect(skills.map((s) => s.id).sort()).toEqual(['skill-a', 'skill-b'])
  })

  it('should load universal SKILL.md format with YAML frontmatter', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'humanizer')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: humanizer-zh\ndescription: |\n  去除文本中的 AI 生成痕迹。\n  使内容更自然、更像人类书写。\nmetadata:\n  trigger: 编辑或审阅文本时\n---\n\n# Humanizer\n\n你是一位文字编辑，专门去除 AI 痕迹。\n\n## 核心规则\n\n1. 删除填充短语\n2. 打破公式结构\n',
      'utf-8',
    )

    const skills = loadSkills(TEST_WS)
    const skill = skills.find((s) => s.id === 'humanizer')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('humanizer-zh')
    expect(skill!.description).toContain('去除文本中的 AI 生成痕迹')
    expect(skill!.whenToUse).toBe('编辑或审阅文本时')
    // Body is used as promptTemplate (not just ## Prompt section)
    expect(skill!.promptTemplate).toContain('你是一位文字编辑')
    expect(skill!.promptTemplate).toContain('删除填充短语')
  })

  it('should prefer SKILL.md over skill.md when both exist', () => {
    const skillDir = join(TEST_SKILLS_DIR, 'dual')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Universal\n---\n# Universal Skill', 'utf-8')
    writeFileSync(join(skillDir, 'skill.md'), '# Legacy Skill\n\n## Prompt\n\nLegacy prompt', 'utf-8')

    const skills = loadSkills(TEST_WS)
    const skill = skills.find((s) => s.id === 'dual')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('Universal')
  })
})

describe('formatSkillsContext', () => {
  it('should return undefined for empty skills', () => {
    expect(formatSkillsContext([])).toBeUndefined()
  })

  it('should format skills context', () => {
    const result = formatSkillsContext([
      { id: 'review', name: 'Review', description: 'Code review', promptTemplate: 'check', sourcePath: '' },
      { id: 'test', name: 'Test', description: 'Write tests', promptTemplate: 'test', examples: ['example1'], sourcePath: '' },
    ])

    expect(result).toContain('Available Skills')
    expect(result).toContain('Review')
    expect(result).toContain('Test')
    expect(result).toContain('example1')
  })
})

describe('getSkillPrompt', () => {
  it('should substitute template variables', () => {
    const skill = {
      id: 'test',
      name: 'Test',
      description: 'desc',
      promptTemplate: 'Hello {{name}}, welcome to {{place}}',
      sourcePath: '',
    }
    const prompt = getSkillPrompt(skill, { name: 'Alice', place: 'Wonderland' })
    expect(prompt).toBe('Hello Alice, welcome to Wonderland')
  })

  it('should return raw template without context', () => {
    const skill = {
      id: 'test',
      name: 'Test',
      description: 'desc',
      promptTemplate: 'Raw template',
      sourcePath: '',
    }
    expect(getSkillPrompt(skill)).toBe('Raw template')
  })
})
