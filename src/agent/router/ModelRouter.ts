/**
 * ModelRouter — 智能模型路由
 *
 * 根据任务特征自动选择最适合的 LLM 模型配置。
 * 支持多厂商、多层级、规则驱动的模型选择。
 *
 * 设计原则：
 * - 简单任务用轻量模型（省成本、快响应）
 * - 复杂任务用强模型（高质量、长上下文）
 * - 用户可随时覆盖路由决策
 */

import type { LLMConfig, Message } from '../types'

export type ModelTier = 'weak' | 'medium' | 'strong' | 'reasoning' | 'standard' | 'premium'

export interface ModelProfile {
  /** 模型标识名 */
  name: string
  /** 显示名 */
  displayName: string
  /** 厂商 */
  provider: string
  /** API Key */
  apiKey: string
  /** Base URL */
  baseUrl?: string
  /** 最大上下文长度（token） */
  contextWindow: number
  /** 能力等级 */
  tier: ModelTier
  /** 是否支持工具调用 */
  supportsTools: boolean
  /** 是否支持推理/思考过程 */
  supportsReasoning: boolean
  /** 输入价格（每1M tokens） */
  inputPricePer1M: number
  /** 输出价格（每1M tokens） */
  outputPricePer1M: number
  /** 默认 max_tokens */
  defaultMaxTokens: number
  /** 温度 */
  temperature?: number
}

export interface RoutingRule {
  /** 规则名称 */
  name: string
  /** 匹配条件 */
  condition: RoutingCondition
  /** 目标模型 */
  targetModel: string
  /** 规则优先级（数字越大越优先） */
  priority?: number
}

export type RoutingCondition =
  | { type: 'messageTokens'; op: '>' | '<' | '>=' | '<='; value: number }
  | { type: 'toolCount'; op: '>' | '<' | '>=' | '<='; value: number }
  | { type: 'taskContains'; keywords: string[] }
  | { type: 'hasTool'; toolName: string }
  | { type: 'always' }

export interface RouterConfig {
  /** 所有可用模型 */
  models: ModelProfile[]
  /** 路由规则（按优先级排序） */
  rules: RoutingRule[]
  /** 默认模型 */
  defaultModel: string
  /** 是否启用自动降级（强模型失败时降级） */
  enableFallback?: boolean
  /** 降级顺序 */
  fallbackChain?: string[]
}

export interface RoutingContext {
  /** 用户输入 */
  userInput: string
  /** 当前消息历史 */
  messages: Message[]
  /** 可用工具 */
  toolNames: string[]
  /** 当前轮次 */
  round: number
  /** 是否包含图片 */
  hasImages?: boolean
}

export interface RoutingResult {
  /** 选中的模型配置 */
  config: LLMConfig
  /** 模型档案 */
  profile: ModelProfile
  /** 选择原因 */
  reason: string
  /** 匹配的规则名 */
  matchedRule?: string
}

/**
 * 估算消息历史的 token 数（简化版）
 */
function estimateMessageTokens(messages: Message[]): number {
  let total = 0
  for (const m of messages) {
    const content = 'content' in m ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) : ''
    // CJK ~1 token per char, Latin ~0.25 token per char
    for (const ch of content) {
      total += ch.charCodeAt(0) > 127 ? 1 : 0.25
    }
  }
  return Math.ceil(total)
}

/**
 * 评估条件是否匹配
 */
function evaluateCondition(condition: RoutingCondition, ctx: RoutingContext): boolean {
  switch (condition.type) {
    case 'always':
      return true
    case 'messageTokens': {
      const tokens = estimateMessageTokens(ctx.messages)
      switch (condition.op) {
        case '>': return tokens > condition.value
        case '<': return tokens < condition.value
        case '>=': return tokens >= condition.value
        case '<=': return tokens <= condition.value
      }
      return false
    }
    case 'toolCount': {
      const count = ctx.toolNames.length
      switch (condition.op) {
        case '>': return count > condition.value
        case '<': return count < condition.value
        case '>=': return count >= condition.value
        case '<=': return count <= condition.value
      }
      return false
    }
    case 'taskContains': {
      const text = ctx.userInput.toLowerCase()
      return condition.keywords.some((k) => text.includes(k.toLowerCase()))
    }
    case 'hasTool':
      return ctx.toolNames.includes(condition.toolName)
  }
}

/**
 * 模型路由器
 */
export class ModelRouter {
  private config: RouterConfig
  private profileMap: Map<string, ModelProfile>

  constructor(config: RouterConfig) {
    this.config = { ...config }
    this.profileMap = new Map(config.models.map((m) => [m.name, m]))
    // Sort rules by priority descending
    this.config.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }

  /**
   * 根据上下文选择最佳模型
   */
  select(ctx: RoutingContext): RoutingResult {
    // 1. 评估所有规则
    for (const rule of this.config.rules) {
      if (evaluateCondition(rule.condition, ctx)) {
        const profile = this.profileMap.get(rule.targetModel)
        if (profile) {
          return {
            config: this.profileToConfig(profile),
            profile,
            reason: `Matched rule: ${rule.name}`,
            matchedRule: rule.name,
          }
        }
      }
    }

    // 2. 回退到默认模型
    const defaultProfile = this.profileMap.get(this.config.defaultModel)
    if (defaultProfile) {
      return {
        config: this.profileToConfig(defaultProfile),
        profile: defaultProfile,
        reason: 'Fallback to default model',
      }
    }

    // 3. 极端回退：第一个可用模型
    const first = this.config.models[0]
    return {
      config: this.profileToConfig(first),
      profile: first,
      reason: 'Extreme fallback: first available model',
    }
  }

  /**
   * 获取降级链中的下一个模型
   */
  getFallback(currentModel: string): RoutingResult | undefined {
    if (!this.config.enableFallback || !this.config.fallbackChain) return undefined

    const idx = this.config.fallbackChain.indexOf(currentModel)
    if (idx === -1 || idx >= this.config.fallbackChain.length - 1) return undefined

    const nextName = this.config.fallbackChain[idx + 1]
    const profile = this.profileMap.get(nextName)
    if (!profile) return undefined

    return {
      config: this.profileToConfig(profile),
      profile,
      reason: `Fallback from ${currentModel} to ${nextName}`,
    }
  }

  /**
   * 强制选择指定模型
   */
  forceSelect(modelName: string): RoutingResult {
    const profile = this.profileMap.get(modelName)
    if (!profile) {
      throw new Error(`Model '${modelName}' not found in router config`)
    }
    return {
      config: this.profileToConfig(profile),
      profile,
      reason: `User forced: ${modelName}`,
    }
  }

  /**
   * 列出所有可用模型
   */
  listModels(): ModelProfile[] {
    return [...this.config.models]
  }

  private profileToConfig(profile: ModelProfile): LLMConfig {
    return {
      provider: profile.provider,
      model: profile.name,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      maxTokens: profile.defaultMaxTokens,
      temperature: profile.temperature,
      contextWindow: profile.contextWindow,
    }
  }
}

// ── 预设配置工厂 ──

/**
 * 创建双模型配置（轻量+强力）
 */
export function createDualModelConfig(
  fastModel: { name: string; provider: string; apiKey: string; baseUrl?: string },
  strongModel: { name: string; provider: string; apiKey: string; baseUrl?: string },
): RouterConfig {
  return {
    models: [
      {
        name: fastModel.name,
        displayName: 'Fast',
        provider: fastModel.provider,
        apiKey: fastModel.apiKey,
        baseUrl: fastModel.baseUrl,
        contextWindow: 128000,
        tier: 'medium',
        supportsTools: true,
        supportsReasoning: false,
        inputPricePer1M: 0.15,
        outputPricePer1M: 0.6,
        defaultMaxTokens: 4096,
        temperature: 0.3,
      },
      {
        name: strongModel.name,
        displayName: 'Strong',
        provider: strongModel.provider,
        apiKey: strongModel.apiKey,
        baseUrl: strongModel.baseUrl,
        contextWindow: 200000,
        tier: 'strong',
        supportsTools: true,
        supportsReasoning: true,
        inputPricePer1M: 2.0,
        outputPricePer1M: 8.0,
        defaultMaxTokens: 8192,
        temperature: 0.3,
      },
    ],
    rules: [
      {
        name: 'Long context → Strong',
        condition: { type: 'messageTokens', op: '>', value: 60000 },
        targetModel: strongModel.name,
        priority: 100,
      },
      {
        name: 'Many tools → Strong',
        condition: { type: 'toolCount', op: '>', value: 8 },
        targetModel: strongModel.name,
        priority: 90,
      },
      {
        name: 'Complex task → Strong',
        condition: { type: 'taskContains', keywords: ['refactor', 'architecture', 'design', 'complex', 'debug'] },
        targetModel: strongModel.name,
        priority: 80,
      },
      {
        name: 'Code generation → Strong',
        condition: { type: 'taskContains', keywords: ['write', 'implement', 'create', 'generate code'] },
        targetModel: strongModel.name,
        priority: 70,
      },
    ],
    defaultModel: fastModel.name,
    enableFallback: true,
    fallbackChain: [strongModel.name, fastModel.name],
  }
}

/**
 * 创建三档模型配置（弱/中/强）
 */
export function createTriModelConfig(
  weakModel: { name: string; provider: string; apiKey: string; baseUrl?: string },
  mediumModel: { name: string; provider: string; apiKey: string; baseUrl?: string },
  strongModel: { name: string; provider: string; apiKey: string; baseUrl?: string },
): RouterConfig {
  return {
    models: [
      {
        name: weakModel.name,
        displayName: 'Weak',
        provider: weakModel.provider,
        apiKey: weakModel.apiKey,
        baseUrl: weakModel.baseUrl,
        contextWindow: 128000,
        tier: 'weak',
        supportsTools: true,
        supportsReasoning: false,
        inputPricePer1M: 0.15,
        outputPricePer1M: 0.6,
        defaultMaxTokens: 4096,
        temperature: 0.3,
      },
      {
        name: mediumModel.name,
        displayName: 'Medium',
        provider: mediumModel.provider,
        apiKey: mediumModel.apiKey,
        baseUrl: mediumModel.baseUrl,
        contextWindow: 200000,
        tier: 'medium',
        supportsTools: true,
        supportsReasoning: false,
        inputPricePer1M: 1.0,
        outputPricePer1M: 3.0,
        defaultMaxTokens: 8192,
        temperature: 0.3,
      },
      {
        name: strongModel.name,
        displayName: 'Strong',
        provider: strongModel.provider,
        apiKey: strongModel.apiKey,
        baseUrl: strongModel.baseUrl,
        contextWindow: 200000,
        tier: 'strong',
        supportsTools: true,
        supportsReasoning: true,
        inputPricePer1M: 2.0,
        outputPricePer1M: 8.0,
        defaultMaxTokens: 8192,
        temperature: 0.3,
      },
    ],
    rules: [
      {
        name: 'Simple Q&A → Weak',
        condition: { type: 'taskContains', keywords: ['hello', 'hi', 'explain', 'what is', 'how to', 'summary'] },
        targetModel: weakModel.name,
        priority: 50,
      },
      {
        name: 'Medium context → Medium',
        condition: { type: 'messageTokens', op: '>', value: 30000 },
        targetModel: mediumModel.name,
        priority: 100,
      },
      {
        name: 'Long context → Strong',
        condition: { type: 'messageTokens', op: '>', value: 100000 },
        targetModel: strongModel.name,
        priority: 110,
      },
      {
        name: 'Many tools → Strong',
        condition: { type: 'toolCount', op: '>', value: 6 },
        targetModel: strongModel.name,
        priority: 90,
      },
      {
        name: 'Complex task → Strong',
        condition: { type: 'taskContains', keywords: ['refactor', 'architecture', 'design', 'complex', 'debug'] },
        targetModel: strongModel.name,
        priority: 80,
      },
      {
        name: 'Code generation → Medium+',
        condition: { type: 'taskContains', keywords: ['write', 'implement', 'create', 'generate code'] },
        targetModel: mediumModel.name,
        priority: 70,
      },
    ],
    defaultModel: weakModel.name,
    enableFallback: true,
    fallbackChain: [strongModel.name, mediumModel.name, weakModel.name],
  }
}
