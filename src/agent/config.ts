/**
 * 配置系统 — 分层加载 + Zod 校验
 *
 * 加载优先级（高到低）：
 *   1. CLI 参数 (process.argv)
 *   2. 环境变量 (process.env)
 *   3. 项目级 .note_agent/config.json
 *   4. 用户级 ~/.note_agent/config.json
 *   5. 代码默认值
 */
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// ── Zod Schema ──

export const configSchema = z.object({
  // LLM
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o-mini'),
  apiKey: z.string().default(''),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  fallbackModel: z.string().optional(),

  // Workspace
  workspace: z.string().default(process.cwd()),
  mode: z.enum(['explore', 'ask', 'execute']).default('ask'),

  // Engine — total LLM rounds before the agent is forced to stop.
  // Multi-step tasks (read → think → write → run → debug → re-run …) routinely
  // need 10-30 rounds; ppt/docx generation can hit 40+. 50 is a safe ceiling
  // that still bounds runaway loops.
  maxRounds: z.number().int().positive().default(50),

  // Memory
  memory: z.object({
    enabled: z.boolean().default(true),
    autoCompact: z.boolean().default(true),
    compactThreshold: z.number().int().positive().default(160_000), // tokens
  }).default({ enabled: true, autoCompact: true, compactThreshold: 160_000 }),

  // Tools
  tools: z.object({
    disabled: z.array(z.string()).default([]),
    maxResultSizeChars: z.number().int().positive().default(50_000),
  }).default({ disabled: [], maxResultSizeChars: 50_000 }),

  // Cost
  cost: z.object({
    track: z.boolean().default(true),
    inputPricePer1M: z.number().default(0),
    outputPricePer1M: z.number().default(0),
  }).default({ track: true, inputPricePer1M: 0, outputPricePer1M: 0 }),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logDir: z.string().default(join(getUserConfigDir(), 'logs')),

  // MCP
  mcp: z.object({
    servers: z.array(z.object({
      name: z.string(),
      transport: z.enum(['stdio', 'sse']),
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
      url: z.string().optional(),
    })).default([]),
  }).default({ servers: [] }),
})

export type AgentConfig = z.infer<typeof configSchema>

// ── Defaults ──

const DEFAULTS: AgentConfig = configSchema.parse({})

// ── Helpers ──

function getUserConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.'
  return join(home, '.note_agent')
}

function getProjectConfigDir(cwd: string = process.cwd()): string {
  return join(cwd, '.note_agent')
}

function loadJsonFile<T>(path: string): Partial<T> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as Partial<T>
  } catch {
    return undefined
  }
}

function parseEnvVars(): Partial<AgentConfig> {
  const env: Record<string, any> = {}

  if (process.env.NA_PROVIDER) env.provider = process.env.NA_PROVIDER
  if (process.env.NA_MODEL) env.model = process.env.NA_MODEL
  if (process.env.NA_API_KEY) env.apiKey = process.env.NA_API_KEY
  if (process.env.NA_BASE_URL) env.baseUrl = process.env.NA_BASE_URL
  if (process.env.NA_WORKSPACE) env.workspace = process.env.NA_WORKSPACE
  if (process.env.NA_MODE) env.mode = process.env.NA_MODE
  if (process.env.NA_MAX_ROUNDS) env.maxRounds = parseInt(process.env.NA_MAX_ROUNDS, 10)
  if (process.env.NA_MAX_TOKENS) env.maxTokens = parseInt(process.env.NA_MAX_TOKENS, 10)
  if (process.env.NA_TEMPERATURE) env.temperature = parseFloat(process.env.NA_TEMPERATURE)

  return env
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): Partial<AgentConfig> {
  const args: Record<string, any> = {}
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    const next = argv[i + 1]

    switch (arg) {
      case '--provider':
        if (next) { args.provider = next; i += 2; continue }
        break
      case '--model':
        if (next) { args.model = next; i += 2; continue }
        break
      case '--api-key':
        if (next) { args.apiKey = next; i += 2; continue }
        break
      case '--base-url':
        if (next) { args.baseUrl = next; i += 2; continue }
        break
      case '--workspace':
      case '-w':
        if (next) { args.workspace = next; i += 2; continue }
        break
      case '--mode':
      case '-m':
        if (next) { args.mode = next; i += 2; continue }
        break
      case '--max-rounds':
        if (next) { args.maxRounds = parseInt(next, 10); i += 2; continue }
        break
      case '--max-tokens':
        if (next) { args.maxTokens = parseInt(next, 10); i += 2; continue }
        break
      case '--temperature':
        if (next) { args.temperature = parseFloat(next); i += 2; continue }
        break
      case '--log-level':
        if (next) { args.logLevel = next; i += 2; continue }
        break
      case '--no-memory':
        args.memory = { enabled: false }
        i += 1
        continue
      case '--no-compact':
        args.memory = { ...(args.memory || {}), autoCompact: false }
        i += 1
        continue
    }
    i += 1
  }
  return args
}

// ── Main Load Function ──

/**
 * 加载并合并配置，按优先级从高到低：
 *   CLI args > env vars > project config > user config > defaults
 */
export function loadConfig(argv?: string[]): AgentConfig {
  const userConfigPath = join(getUserConfigDir(), 'config.json')
  const projectConfigPath = join(getProjectConfigDir(), 'config.json')

  const userConfig = loadJsonFile<AgentConfig>(userConfigPath) || {}
  const projectConfig = loadJsonFile<AgentConfig>(projectConfigPath) || {}
  const envConfig = parseEnvVars()
  const cliConfig = parseCliArgs(argv)

  // Deep merge: CLI > env > project > user > defaults
  const merged = deepMerge(
    DEFAULTS,
    userConfig,
    projectConfig,
    envConfig,
    cliConfig,
  )

  // Validate
  const result = configSchema.safeParse(merged)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
    throw new Error(`Config validation failed:\n  ${issues}`)
  }

  // Resolve workspace to absolute path
  result.data.workspace = resolve(result.data.workspace)

  return result.data
}

// ── Deep Merge ──

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function deepMerge<T extends Record<string, unknown>>(base: T, ...sources: Array<Partial<T> | Record<string, unknown> | undefined>): T {
  const result = { ...base } as T

  for (const source of sources) {
    if (!source) continue
    for (const [key, val] of Object.entries(source)) {
      if (val === undefined) continue
      if (isObject(val) && isObject(result[key as keyof T])) {
        (result as any)[key] = deepMerge((result as any)[key], val)
      } else {
        (result as any)[key] = val
      }
    }
  }

  return result
}

// ── Config Save ──

export function saveUserConfig(config: Partial<AgentConfig>): void {
  const dir = getUserConfigDir()
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs')
    mkdirSync(dir, { recursive: true })
  }
  const { writeFileSync } = require('fs')
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
}
