/**
 * MultiProviderEngine — 跨厂商多模型会话引擎
 *
 * 核心能力：
 * 1. 单会话中切换 provider/model（消息历史跨厂商兼容）
 * 2. 显式模型切换 API（switchModel / switchProvider）
 * 3. 自动降级链（Fallback chain）
 * 4. 每轮消息标注使用的模型
 *
 * 跨厂商兼容性：
 * - OpenAI 和 Anthropic 的消息格式已基本统一（system/user/assistant/tool）
 * - 我们的 Message 类型是抽象层，client.ts 负责厂商-specific 转换
 * - 因此消息历史可以在不同厂商间无缝传递
 */

import { AgentEngine, type AgentEngineOptions } from './AgentEngine'
import type { Message, LLMConfig, AgentEvent } from '../types'
import type { ModelRouter, RoutingResult } from '../router/ModelRouter'
import { logger } from '../logger'

export interface MultiProviderEngineOptions extends AgentEngineOptions {
  /** 初始模型（覆盖 llmConfig） */
  initialModel?: string
  /** 是否启用自动降级 */
  enableAutoFallback?: boolean
}

export interface ModelSwitchRecord {
  round: number
  timestamp: number
  from: { provider: string; model: string }
  to: { provider: string; model: string }
  reason: string
}

export class MultiProviderEngine extends AgentEngine {
  private switchHistory: ModelSwitchRecord[] = []
  private currentRoutingResult?: RoutingResult
  private enableAutoFallback: boolean

  constructor(opts: MultiProviderEngineOptions) {
    // If initialModel specified and router exists, force-select it
    if (opts.initialModel && opts.modelRouter) {
      const forced = opts.modelRouter.forceSelect(opts.initialModel)
      opts = { ...opts, llmConfig: forced.config }
    }
    super(opts)
    this.enableAutoFallback = opts.enableAutoFallback ?? true
  }

  /**
   * 显式切换到指定模型（通过 ModelRouter）
   */
  switchModel(modelName: string): LLMConfig {
    const router = (this as any).opts.modelRouter as ModelRouter | undefined
    if (!router) {
      throw new Error('No ModelRouter configured. Set modelRouter in options.')
    }

    const routing = router.forceSelect(modelName)
    this.recordSwitch(routing.config, `User switched to ${modelName}`)
    return routing.config
  }

  /**
   * 显式切换 Provider（无需 ModelRouter）
   */
  switchProvider(config: LLMConfig): LLMConfig {
    this.recordSwitch(config, `User switched provider to ${config.provider}:${config.model}`)
    // Update the engine's llmConfig via internal opts reference
    ;(this as any).opts.llmConfig = config
    return config
  }

  /**
   * 获取切换历史
   */
  getSwitchHistory(): ModelSwitchRecord[] {
    return [...this.switchHistory]
  }

  /**
   * 获取当前模型信息
   */
  getCurrentModel(): { provider: string; model: string } {
    const opts = (this as any).opts as AgentEngineOptions
    return { provider: opts.llmConfig.provider, model: opts.llmConfig.model }
  }

  /**
   * 尝试降级到下一个模型
   */
  tryFallback(): LLMConfig | undefined {
    const router = (this as any).opts.modelRouter as ModelRouter | undefined
    if (!router || !this.enableAutoFallback) return undefined

    const current = this.getCurrentModel()
    const fallback = router.getFallback(current.model)
    if (!fallback) return undefined

    this.recordSwitch(fallback.config, `Auto-fallback from ${current.model} to ${fallback.config.model}`)
    ;(this as any).opts.llmConfig = fallback.config
    logger.info('Auto-fallback triggered', { from: current.model, to: fallback.config.model })
    return fallback.config
  }

  /**
   * 重写 submit：在模型切换时发出事件
   */
  async *submit(userInput: string): AsyncGenerator<AgentEvent, void, unknown> {
    const router = (this as any).opts.modelRouter as ModelRouter | undefined
    let lastModel = ''

    // Intercept the parent generator to inject model-switch events
    const parentGen = super.submit(userInput)

    for await (const event of parentGen) {
      // Check if model has changed (via router function)
      if (router) {
        const current = this.getCurrentModel()
        if (current.model !== lastModel && lastModel !== '') {
          yield {
            type: 'model-switch',
            provider: current.provider,
            model: current.model,
            reason: `Auto-routed from ${lastModel}`,
          }
        }
        lastModel = current.model
      }

      yield event
    }
  }

  private recordSwitch(config: LLMConfig, reason: string): void {
    const current = this.getCurrentModel()
    this.switchHistory.push({
      round: this.switchHistory.length,
      timestamp: Date.now(),
      from: { provider: current.provider, model: current.model },
      to: { provider: config.provider, model: config.model },
      reason,
    })
    // Update internal config
    ;(this as any).opts.llmConfig = config
  }
}
