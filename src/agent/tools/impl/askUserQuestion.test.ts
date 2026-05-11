/**
 * AskUserQuestionTool 全面测试
 */
import { describe, it, expect } from 'bun:test'
import { AskUserQuestionTool } from './askUserQuestion'
import type { ToolContext } from '../Tool'

const ctx: ToolContext = { workspacePath: process.cwd(), mode: 'explore' }

describe('AskUserQuestionTool', () => {
  it('should format question with context', async () => {
    const result = await AskUserQuestionTool.call(
      { question: 'What is your preference?', context: 'Choosing a framework' } as any,
      ctx,
    )
    expect(result.error).toBeUndefined()
    expect(result.data.questions.map((q) => q.question)).toContain('What is your preference?')
    expect(result.data.questions.some((q) => q.question.includes('What is your preference?'))).toBe(true)
  })

  it('should include options when provided', async () => {
    const result = await AskUserQuestionTool.call(
      { question: 'Which color?', options: ['Red', 'Green', 'Blue'] } as any,
      ctx,
    )
    expect(result.error).toBeUndefined()
    const questions = result.data.questions.map((q) => q.question)
    expect(questions).toContain('Which color?')
    const allOptions = result.data.questions.flatMap((q) => q.options || [])
    expect(allOptions).toContain('Red')
    expect(allOptions).toContain('Green')
    expect(allOptions).toContain('Blue')
  })

  it('should be read-only and safe', () => {
    expect(AskUserQuestionTool.isReadOnly()).toBe(true)
    expect(AskUserQuestionTool.isConcurrencySafe()).toBe(true)
    expect(AskUserQuestionTool.isDestructive()).toBe(false)
  })
})
