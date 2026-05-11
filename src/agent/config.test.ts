/**
 * 配置系统测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig, parseCliArgs, configSchema, type AgentConfig } from './config'

describe('configSchema', () => {
  it('should parse minimal config with defaults', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.provider).toBe('openai')
      expect(result.data.model).toBe('gpt-4o-mini')
      expect(result.data.mode).toBe('ask')
      expect(result.data.maxRounds).toBe(50)
      expect(result.data.memory.enabled).toBe(true)
      expect(result.data.memory.autoCompact).toBe(true)
      expect(result.data.tools.maxResultSizeChars).toBe(50_000)
      expect(result.data.cost.track).toBe(true)
      expect(result.data.mcp.servers).toEqual([])
    }
  })

  it('should reject invalid mode', () => {
    const result = configSchema.safeParse({ mode: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('should reject negative maxRounds', () => {
    const result = configSchema.safeParse({ maxRounds: -1 })
    expect(result.success).toBe(false)
  })

  it('should accept valid full config', () => {
    const result = configSchema.safeParse({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com',
      maxTokens: 4096,
      temperature: 0.5,
      workspace: '/tmp/test',
      mode: 'execute',
      maxRounds: 10,
      memory: { enabled: false, autoCompact: false, compactThreshold: 100_000 },
      tools: { disabled: ['writeFile'], maxResultSizeChars: 10_000 },
      cost: { track: true, inputPricePer1M: 3.0, outputPricePer1M: 15.0 },
    })
    expect(result.success).toBe(true)
  })
})

describe('parseCliArgs', () => {
  it('should parse --provider', () => {
    const cfg = parseCliArgs(['--provider', 'anthropic'])
    expect(cfg.provider).toBe('anthropic')
  })

  it('should parse --model and --api-key', () => {
    const cfg = parseCliArgs(['--model', 'gpt-4o', '--api-key', 'sk-xxx'])
    expect(cfg.model).toBe('gpt-4o')
    expect(cfg.apiKey).toBe('sk-xxx')
  })

  it('should parse -w and -m shortcuts', () => {
    const cfg = parseCliArgs(['-w', '/tmp/proj', '-m', 'explore'])
    expect(cfg.workspace).toBe('/tmp/proj')
    expect(cfg.mode).toBe('explore')
  })

  it('should parse numeric args', () => {
    const cfg = parseCliArgs(['--max-rounds', '3', '--max-tokens', '2048', '--temperature', '0.3'])
    expect(cfg.maxRounds).toBe(3)
    expect(cfg.maxTokens).toBe(2048)
    expect(cfg.temperature).toBe(0.3)
  })

  it('should parse --no-memory', () => {
    const cfg = parseCliArgs(['--no-memory'])
    expect(cfg.memory).toMatchObject({ enabled: false })
  })

  it('should parse --no-compact', () => {
    const cfg = parseCliArgs(['--no-compact'])
    expect(cfg.memory).toMatchObject({ autoCompact: false })
  })

  it('should return empty for unknown args', () => {
    const cfg = parseCliArgs(['--unknown', 'value'])
    expect(Object.keys(cfg).length).toBe(0)
  })
})

describe('loadConfig priority', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clean env vars that affect config
    delete process.env.NA_PROVIDER
    delete process.env.NA_MODEL
    delete process.env.NA_API_KEY
    delete process.env.NA_MODE
  })

  afterEach(() => {
    Object.assign(process.env, originalEnv)
  })

  it('should use defaults when nothing provided', () => {
    const cfg = loadConfig([])
    expect(cfg.provider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o-mini')
    expect(cfg.mode).toBe('ask')
  })

  it('CLI args should override env vars', () => {
    process.env.NA_PROVIDER = 'env-provider'
    process.env.NA_MODEL = 'env-model'

    const cfg = loadConfig(['--provider', 'cli-provider', '--model', 'cli-model'])
    expect(cfg.provider).toBe('cli-provider')
    expect(cfg.model).toBe('cli-model')
  })

  it('env vars should override defaults', () => {
    process.env.NA_PROVIDER = 'openai-compatible'
    process.env.NA_MODEL = 'minimax-m2.7'

    const cfg = loadConfig([])
    expect(cfg.provider).toBe('openai-compatible')
    expect(cfg.model).toBe('minimax-m2.7')
  })
})
