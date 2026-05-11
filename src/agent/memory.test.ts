/**
 * 记忆管理系统测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  loadWorkspaceMemory,
  loadUserProfile,
  buildMemoryContext,
  formatMemoryContext,
  appendSessionMemory,
  getSessionMemory,
  clearSessionMemory,
  extractKeyPoints,
} from './memory'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TEST_WS = join(process.cwd(), 'test-workspace-memory')
const TEST_NOTEAGENT = join(TEST_WS, '.note_agent', 'NOTEAGENT.md')
const TEST_USER_PROFILE = join(homedir(), '.note_agent', 'user-profile.md')

describe('loadWorkspaceMemory', () => {
  beforeEach(() => {
    if (!existsSync(join(TEST_WS, '.note_agent'))) {
      mkdirSync(join(TEST_WS, '.note_agent'), { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_WS)) {
      rmSync(TEST_WS, { recursive: true, force: true })
    }
  })

  it('should return undefined when NOTEAGENT.md does not exist', () => {
    const result = loadWorkspaceMemory(TEST_WS)
    expect(result).toBeUndefined()
  })

  it('should read NOTEAGENT.md content', () => {
    writeFileSync(TEST_NOTEAGENT, 'This is a React project using TypeScript.', 'utf-8')
    const result = loadWorkspaceMemory(TEST_WS)
    expect(result).toBe('This is a React project using TypeScript.')
  })

  it('should return undefined for empty file', () => {
    writeFileSync(TEST_NOTEAGENT, '', 'utf-8')
    const result = loadWorkspaceMemory(TEST_WS)
    expect(result).toBeUndefined()
  })

  it('should trim whitespace', () => {
    writeFileSync(TEST_NOTEAGENT, '  \n  content  \n  ', 'utf-8')
    const result = loadWorkspaceMemory(TEST_WS)
    expect(result).toBe('content')
  })
})

describe('buildMemoryContext', () => {
  beforeEach(() => {
    if (!existsSync(join(TEST_WS, '.note_agent'))) {
      mkdirSync(join(TEST_WS, '.note_agent'), { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_WS)) {
      rmSync(TEST_WS, { recursive: true, force: true })
    }
    if (existsSync(TEST_USER_PROFILE)) {
      rmSync(TEST_USER_PROFILE)
    }
  })

  it('should return workspace memory when present', () => {
    writeFileSync(TEST_NOTEAGENT, 'Project uses Next.js', 'utf-8')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.workspaceMemory).toBe('Project uses Next.js')
    expect(ctx.userProfile).toBeUndefined()
  })

  it('should return user profile when present', () => {
    writeFileSync(TEST_USER_PROFILE, 'User prefers 2-space indentation', 'utf-8')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.userProfile).toBe('User prefers 2-space indentation')
  })

  it('should return both when present', () => {
    writeFileSync(TEST_NOTEAGENT, 'Project info', 'utf-8')
    writeFileSync(TEST_USER_PROFILE, 'User info', 'utf-8')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.workspaceMemory).toBe('Project info')
    expect(ctx.userProfile).toBe('User info')
  })
})

describe('formatMemoryContext', () => {
  it('should format workspace memory only', () => {
    const formatted = formatMemoryContext({ workspaceMemory: 'Project info' })
    expect(formatted).toContain('Project Context')
    expect(formatted).toContain('Project info')
    expect(formatted).not.toContain('User Profile')
  })

  it('should format all three memories', () => {
    const formatted = formatMemoryContext({
      workspaceMemory: 'Project info',
      userProfile: 'User info',
      sessionMemory: 'Session info',
    })
    expect(formatted).toContain('Project Context')
    expect(formatted).toContain('User Profile')
    expect(formatted).toContain('Session Memory')
  })

  it('should return empty string when no memories', () => {
    const formatted = formatMemoryContext({})
    expect(formatted).toBe('')
  })
})

describe('extractKeyPoints', () => {
  it('should extract user instructions', () => {
    const messages = [
      { role: 'user', content: 'always use async/await' },
      { role: 'assistant', content: 'ok' },
    ]
    const points = extractKeyPoints(messages)
    expect(points.length).toBeGreaterThan(0)
    expect(points[0]).toContain('always')
  })

  it('should not extract regular user messages', () => {
    const messages = [
      { role: 'user', content: 'hello how are you' },
      { role: 'assistant', content: 'fine' },
    ]
    const points = extractKeyPoints(messages)
    expect(points.length).toBe(0)
  })

  it('should extract tool results', () => {
    const messages = [
      { role: 'tool', content: 'found 3 files', toolName: 'globSearch' },
    ]
    const points = extractKeyPoints(messages)
    expect(points.length).toBe(1)
    expect(points[0]).toContain('globSearch')
  })
})
