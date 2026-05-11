/**
 * Coordinator 测试
 */
import { describe, it, expect } from 'bun:test'
import { Coordinator } from './Coordinator'

describe('Coordinator', () => {
  it('should initialize with workers', async () => {
    const coord = new Coordinator({
      llmConfig: {
        provider: 'openai',
        model: 'test',
        apiKey: 'test-key',
        baseUrl: 'https://test.com',
      },
      workspacePath: process.cwd(),
      workers: [
        { name: 'coder', model: 'gpt-4o' },
        { name: 'reviewer', model: 'gpt-4o-mini' },
      ],
    })
    await coord.initialize()
    expect(coord.getWorkerNames()).toEqual(['coder', 'reviewer'])
  })

  it('should return worker names after init', async () => {
    const coord = new Coordinator({
      llmConfig: {
        provider: 'openai',
        model: 'test',
        apiKey: 'test-key',
        baseUrl: 'https://test.com',
      },
      workspacePath: process.cwd(),
      workers: [{ name: 'worker1' }],
    })
    await coord.initialize()
    expect(coord.getWorkerNames()).toEqual(['worker1'])
  })
})
