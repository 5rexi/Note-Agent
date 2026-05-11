/**
 * ModelRouter 测试
 */
import { describe, it, expect } from 'bun:test'
import { ModelRouter, createDualModelConfig, type RoutingContext } from './ModelRouter'

describe('ModelRouter', () => {
  const router = new ModelRouter({
    models: [
      {
        name: 'gpt-4o-mini',
        displayName: 'Fast',
        provider: 'openai',
        apiKey: 'test-fast',
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
        apiKey: 'test-strong',
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
    rules: [
      {
        name: 'Long context → Strong',
        condition: { type: 'messageTokens', op: '>', value: 1000 },
        targetModel: 'MiniMax-M2.7',
        priority: 100,
      },
      {
        name: 'Complex task → Strong',
        condition: { type: 'taskContains', keywords: ['refactor'] },
        targetModel: 'MiniMax-M2.7',
        priority: 80,
      },
    ],
    defaultModel: 'gpt-4o-mini',
    enableFallback: true,
    fallbackChain: ['MiniMax-M2.7', 'gpt-4o-mini'],
  })

  it('should select default model for simple tasks', () => {
    const ctx: RoutingContext = {
      userInput: 'Say hello',
      messages: [{ role: 'user', content: 'Say hello' }],
      toolNames: ['readFile'],
      round: 0,
    }
    const result = router.select(ctx)
    expect(result.config.model).toBe('gpt-4o-mini')
    expect(result.profile.tier).toBe('standard')
  })

  it('should route to strong model for long context', () => {
    const ctx: RoutingContext = {
      userInput: 'Summarize this',
      messages: [{ role: 'user', content: 'a'.repeat(5000) }],
      toolNames: ['readFile'],
      round: 0,
    }
    const result = router.select(ctx)
    expect(result.config.model).toBe('MiniMax-M2.7')
    expect(result.matchedRule).toBe('Long context → Strong')
  })

  it('should route to strong model for complex keywords', () => {
    const ctx: RoutingContext = {
      userInput: 'Please refactor this codebase',
      messages: [{ role: 'user', content: 'Please refactor this codebase' }],
      toolNames: ['readFile'],
      round: 0,
    }
    const result = router.select(ctx)
    expect(result.config.model).toBe('MiniMax-M2.7')
    expect(result.matchedRule).toBe('Complex task → Strong')
  })

  it('should force select a specific model', () => {
    const result = router.forceSelect('MiniMax-M2.7')
    expect(result.config.model).toBe('MiniMax-M2.7')
    expect(result.reason).toContain('forced')
  })

  it('should throw on unknown forced model', () => {
    expect(() => router.forceSelect('unknown')).toThrow("Model 'unknown' not found")
  })

  it('should provide fallback chain', () => {
    const fallback = router.getFallback('MiniMax-M2.7')
    expect(fallback).toBeDefined()
    expect(fallback!.config.model).toBe('gpt-4o-mini')
  })

  it('should return undefined when no more fallback', () => {
    const fallback = router.getFallback('gpt-4o-mini')
    expect(fallback).toBeUndefined()
  })

  it('should list all models', () => {
    const models = router.listModels()
    expect(models.length).toBe(2)
    expect(models.map((m) => m.name)).toContain('gpt-4o-mini')
    expect(models.map((m) => m.name)).toContain('MiniMax-M2.7')
  })
})

describe('createDualModelConfig', () => {
  it('should create a dual model config', () => {
    const config = createDualModelConfig(
      { name: 'fast-model', provider: 'openai', apiKey: 'fast-key' },
      { name: 'strong-model', provider: 'openai', apiKey: 'strong-key', baseUrl: 'https://api.strong.com/v1' },
    )
    expect(config.models.length).toBe(2)
    expect(config.defaultModel).toBe('fast-model')
    expect(config.rules.length).toBeGreaterThan(0)
    expect(config.enableFallback).toBe(true)
  })
})
