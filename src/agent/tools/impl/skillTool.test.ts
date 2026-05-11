/**
 * SkillTool 全面测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { SkillTool } from '../../skills/skillTool'
import { registerTool, clearRegistry } from '../registry'
import type { ToolContext } from '../Tool'

const TEST_WS = join(process.cwd(), 'test-skilltool')
const TEST_SKILLS_DIR = join(TEST_WS, '.note_agent', 'skills')
const ctx: ToolContext = { workspacePath: TEST_WS, mode: 'explore' }

describe('SkillTool', () => {
  beforeEach(() => {
    if (!existsSync(TEST_SKILLS_DIR)) mkdirSync(TEST_SKILLS_DIR, { recursive: true })
    clearRegistry()
    registerTool(SkillTool)
  })

  afterEach(() => {
    if (existsSync(TEST_WS)) rmSync(TEST_WS, { recursive: true, force: true })
  })

  it('should return skill prompt when skill exists', async () => {
    const skillDir = join(TEST_SKILLS_DIR, 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'skill.md'),
      '# Code Review\n\nReview code for bugs.\n\n## Prompt\n\nReview: {{code}}',
      'utf-8',
    )

    const result = await SkillTool.call({ skillId: 'review', context: { code: 'const x = 1' } }, ctx)
    expect(result.error).toBeUndefined()
    expect(result.data).toContain('Code Review')
    expect(result.data).toContain('Review: const x = 1')
  })

  it('should return error for missing skill', async () => {
    const result = await SkillTool.call({ skillId: 'nonexistent' }, ctx)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('not found')
  })

  it('should be read-only', () => {
    expect(SkillTool.isReadOnly()).toBe(true)
  })
})
