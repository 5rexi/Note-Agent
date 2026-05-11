/**
 * Tool 结果预算限制测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, readFileSync, rmdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { applyBudget } from './budget'
import type { ToolResult } from '../types'

const TEST_RESULTS_DIR = join(homedir(), '.note_agent', 'tool-results')

function cleanTestFiles() {
  if (!existsSync(TEST_RESULTS_DIR)) return
  const files = readdirSync(TEST_RESULTS_DIR)
  for (const f of files) {
    if (f.startsWith('test-')) {
      unlinkSync(join(TEST_RESULTS_DIR, f))
    }
  }
}

describe('applyBudget', () => {
  beforeEach(() => cleanTestFiles())
  afterEach(() => cleanTestFiles())

  it('should return result as-is when under budget', () => {
    const result: ToolResult = { data: 'hello world' }
    const budgeted = applyBudget(result, 1000, 'test-under')

    expect(budgeted.data).toBe('hello world')
    expect(budgeted.truncated).toBeUndefined()
    expect(budgeted.fullResultPath).toBeUndefined()
  })

  it('should truncate when over budget', () => {
    const longData = 'a'.repeat(200)
    const result: ToolResult = { data: longData }
    const budgeted = applyBudget(result, 100, 'test-over')

    expect(budgeted.truncated).toBe(true)
    expect(budgeted.fullResultPath).toBeDefined()
    expect(typeof budgeted.data).toBe('string')
    expect((budgeted.data as string).length).toBeLessThan(200)
    expect((budgeted.data as string)).toContain('[...结果已截断')
  })

  it('should save full result to file when truncated', () => {
    const longData = 'b'.repeat(500)
    const result: ToolResult = { data: longData, preview: 'some preview' }
    const budgeted = applyBudget(result, 100, 'test-save')

    expect(budgeted.fullResultPath).toBeDefined()
    expect(existsSync(budgeted.fullResultPath!)).toBe(true)

    const saved = JSON.parse(readFileSync(budgeted.fullResultPath!, 'utf-8'))
    expect(saved.toolCallId).toBe('test-save')
    expect(saved.result.data).toBe(longData)
    expect(saved.result.preview).toBe('some preview')
  })

  it('should handle object data', () => {
    const obj = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(20) })) }
    const result: ToolResult = { data: obj }
    const budgeted = applyBudget(result, 500, 'test-object')

    const strLen = JSON.stringify(budgeted.data).length
    expect(strLen).toBeLessThanOrEqual(500 + 100) // allow some slack for the notice

    if (budgeted.truncated) {
      expect(budgeted.fullResultPath).toBeDefined()
      expect(existsSync(budgeted.fullResultPath!)).toBe(true)
    }
  })

  it('should preserve other ToolResult fields', () => {
    const result: ToolResult = { data: 'x'.repeat(300), error: 'some error', plan: 'my plan' }
    const budgeted = applyBudget(result, 100, 'test-preserve')

    expect(budgeted.error).toBe('some error')
    expect(budgeted.plan).toBe('my plan')
    expect(budgeted.truncated).toBe(true)
  })

  it('should use default max chars (50000) when not specified', () => {
    const data = 'c'.repeat(1000)
    const result: ToolResult = { data }
    const budgeted = applyBudget(result, undefined as any, 'test-default')

    expect(budgeted.data).toBe(data)
    expect(budgeted.truncated).toBeUndefined()
  })
})
