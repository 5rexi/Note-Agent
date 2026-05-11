/**
 * Subagent 真实 LLM 集成测试
 * 验证子 Agent 端到端运行
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { SubagentTool, setSubagentParentConfig } from './subagent'
import { ReadFileTool } from './readFile'
import { registerTool, clearRegistry } from '../registry'
import type { LLMConfig } from '../../types'

const TEST_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: 'MiniMax-M2.7',
  apiKey: process.env.NA_API_KEY || '',
  baseUrl: process.env.NA_BASE_URL || 'https://api.minimaxi.com/v1',
}

const HAS_API_KEY = !!TEST_LLM_CONFIG.apiKey

describe('SubagentTool (live LLM)', () => {
  beforeAll(() => {
    if (!HAS_API_KEY) {
      console.log('Skipping live LLM tests: NA_API_KEY not set')
    }
    setSubagentParentConfig(TEST_LLM_CONFIG)
    clearRegistry()
    registerTool(ReadFileTool)
  })

  it('should run a simple sub-task and return summary', async () => {
    if (!HAS_API_KEY) return
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: 'Say "hello from subagent"',
      maxRounds: 2,
    }, ctx)

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(typeof result.data).toBe('string')
  }, 30000)

  it('should use tools in sub-agent', async () => {
    if (!HAS_API_KEY) return
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: 'Read package.json and tell me the project name',
      tools: ['readFile'],
      maxRounds: 3,
    }, ctx)

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(typeof result.data).toBe('string')
  }, 30000)

  it('should handle tool whitelist filtering', async () => {
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: 'Simple task',
      tools: ['nonexistentTool'],
      maxRounds: 1,
    }, ctx)

    expect(result.error).toBeDefined()
  })

  it('should respect maxRounds limit', async () => {
    if (!HAS_API_KEY) return
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: 'Count to 3',
      maxRounds: 1,
    }, ctx)

    expect(result.error).toBeUndefined()
  }, 30000)

  it('should use different model when specified', async () => {
    if (!HAS_API_KEY) return
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: 'Say hi',
      model: 'MiniMax-M2.7',
      maxRounds: 1,
    }, ctx)

    expect(result.error).toBeUndefined()
  }, 30000)

  it('should handle invalid task gracefully', async () => {
    if (!HAS_API_KEY) return
    const ctx = { workspacePath: process.cwd(), mode: 'explore' as const }
    const result = await SubagentTool.call({
      task: '',
      maxRounds: 1,
    }, ctx)

    // Empty task should still complete (model may respond with "I need a task")
    expect(typeof result.data).toBe('string')
  }, 30000)
})
