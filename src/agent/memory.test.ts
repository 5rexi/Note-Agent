/**
 * 记忆管理系统测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  loadWorkspaceMemory,
  loadGlobalMemory,
  buildMemoryContext,
  formatMemoryContext,
  appendSessionMemory,
  getSessionMemory,
  clearSessionMemory,
  extractKeyPoints,
} from './memory'
import { setKvMemory, deleteKvMemory } from './persistence'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TEST_WS = join(process.cwd(), 'test-workspace-memory')
const TEST_NOTEAGENT = join(TEST_WS, '.note_agent', 'NOTEAGENT.md')
const GLOBAL_TEST_KEY = '__test_pref__'

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
    deleteKvMemory('global', GLOBAL_TEST_KEY)
  })

  it('should return workspace memory when present', () => {
    writeFileSync(TEST_NOTEAGENT, 'Project uses Next.js', 'utf-8')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.workspaceMemory).toBe('Project uses Next.js')
    expect(ctx.globalMemory).toBeUndefined()
  })

  it('should return global memory when present', () => {
    setKvMemory('global', GLOBAL_TEST_KEY, 'prefers 2-space indentation')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.globalMemory).toContain('prefers 2-space indentation')
  })

  it('should return both when present', () => {
    writeFileSync(TEST_NOTEAGENT, 'Project info', 'utf-8')
    setKvMemory('global', GLOBAL_TEST_KEY, 'user info')
    const ctx = buildMemoryContext(TEST_WS)
    expect(ctx.workspaceMemory).toBe('Project info')
    expect(ctx.globalMemory).toContain('user info')
  })

  it('loadGlobalMemory supersedes on same key (real update)', () => {
    setKvMemory('global', GLOBAL_TEST_KEY, 'first')
    setKvMemory('global', GLOBAL_TEST_KEY, 'second')
    const mem = loadGlobalMemory()
    expect(mem).toContain('second')
    expect(mem).not.toContain('first')
  })
})

describe('formatMemoryContext', () => {
  it('should format workspace memory only', () => {
    const formatted = formatMemoryContext({ workspaceMemory: 'Project info' })
    expect(formatted).toContain('Project Context')
    expect(formatted).toContain('Project info')
    expect(formatted).not.toContain('Global Memory')
  })

  it('should format all three memories', () => {
    const formatted = formatMemoryContext({
      workspaceMemory: 'Project info',
      globalMemory: 'User info',
      sessionMemory: 'Session info',
    })
    expect(formatted).toContain('Project Context')
    expect(formatted).toContain('Global Memory')
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
