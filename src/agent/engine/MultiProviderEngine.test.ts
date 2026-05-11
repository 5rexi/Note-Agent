/**
 * MultiProviderEngine 测试
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { MultiProviderEngine } from './MultiProviderEngine'
import { ModelRouter } from '../router/ModelRouter'
import { ReadFileTool } from '../tools/impl/readFile'

describe('MultiProviderEngine', () => {
  const router = new ModelRouter({
    models: [
      {
        name: 'gpt-4o-mini',
        displayName: 'Fast',
        provider: 'openai',
        apiKey: 'fast-key',
        baseUrl: 'https://api.openai.com/v1',
        contextWindow: 128000,
        tier: 'standard',
        supportsTools: true,
        supportsReasoning: false,
        inputPricePer1M: 0.15,
        outputPricePer1M: 0.6,
        defaultMaxTokens: 4096,
      },
      {
        name: 'MiniMax-M2.7',
        displayName: 'Strong',
        provider: 'openai',
        apiKey: 'strong-key',
        baseUrl: 'https://api.minimaxi.com/v1',
        contextWindow: 200000,
        tier: 'premium',
        supportsTools: true,
        supportsReasoning: true,
        inputPricePer1M: 2.0,
        outputPricePer1M: 8.0,
        defaultMaxTokens: 8192,
      },
    ],
    rules: [],
    defaultModel: 'gpt-4o-mini',
    enableFallback: true,
    fallbackChain: ['MiniMax-M2.7', 'gpt-4o-mini'],
  })

  it('should instantiate with router', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      modelRouter: router,
    })
    expect(engine.getCurrentModel().model).toBe('gpt-4o-mini')
  })

  it('should switch model via router', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      modelRouter: router,
    })

    const config = engine.switchModel('MiniMax-M2.7')
    expect(config.model).toBe('MiniMax-M2.7')
    expect(engine.getCurrentModel().model).toBe('MiniMax-M2.7')
    expect(engine.getSwitchHistory().length).toBe(1)
  })

  it('should switch provider directly', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
    })

    const config = engine.switchProvider({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'claude-key',
      baseUrl: 'https://api.anthropic.com',
    })

    expect(config.provider).toBe('anthropic')
    expect(config.model).toBe('claude-3-5-sonnet')
    expect(engine.getCurrentModel().provider).toBe('anthropic')
  })

  it('should throw when switching model without router', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
    })

    expect(() => engine.switchModel('MiniMax-M2.7')).toThrow('No ModelRouter configured')
  })

  it('should provide fallback chain', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'MiniMax-M2.7', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      modelRouter: router,
      enableAutoFallback: true,
    })

    const fallback = engine.tryFallback()
    expect(fallback).toBeDefined()
    expect(fallback!.model).toBe('gpt-4o-mini')
    expect(engine.getSwitchHistory().length).toBe(1)
  })

  it('should not fallback when disabled', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'MiniMax-M2.7', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      modelRouter: router,
      enableAutoFallback: false,
    })

    const fallback = engine.tryFallback()
    expect(fallback).toBeUndefined()
  })

  it('should track switch history', () => {
    const engine = new MultiProviderEngine({
      llmConfig: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' },
      workspacePath: process.cwd(),
      mode: 'execute',
      tools: [ReadFileTool],
      modelRouter: router,
    })

    engine.switchModel('MiniMax-M2.7')
    engine.switchModel('gpt-4o-mini')

    const history = engine.getSwitchHistory()
    expect(history.length).toBe(2)
    expect(history[0].to.model).toBe('MiniMax-M2.7')
    expect(history[1].to.model).toBe('gpt-4o-mini')
  })
})
