/**
 * 模型定价数据库
 * 支持自定义覆盖
 */
export interface ModelPricing {
  inputPricePer1M: number
  outputPricePer1M: number
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPricePer1M: 5.0, outputPricePer1M: 15.0 },
  'gpt-4o-mini': { inputPricePer1M: 0.15, outputPricePer1M: 0.60 },
  'gpt-4': { inputPricePer1M: 30.0, outputPricePer1M: 60.0 },
  'gpt-4-turbo': { inputPricePer1M: 10.0, outputPricePer1M: 30.0 },
  'o1-mini': { inputPricePer1M: 3.0, outputPricePer1M: 12.0 },
  'o1-preview': { inputPricePer1M: 15.0, outputPricePer1M: 60.0 },
  'o3-mini': { inputPricePer1M: 1.10, outputPricePer1M: 4.40 },
  'claude-3-5-sonnet-20241022': { inputPricePer1M: 3.0, outputPricePer1M: 15.0 },
  'claude-3-5-haiku-20241022': { inputPricePer1M: 0.80, outputPricePer1M: 4.0 },
  'claude-3-opus-20240229': { inputPricePer1M: 15.0, outputPricePer1M: 75.0 },
  'gemini-1.5-pro': { inputPricePer1M: 3.50, outputPricePer1M: 10.50 },
  'gemini-1.5-flash': { inputPricePer1M: 0.35, outputPricePer1M: 1.05 },
  'minimax-m2.7': { inputPricePer1M: 2.0, outputPricePer1M: 8.0 },
  // DeepSeek (pricing in USD converted from RMB at ~7.2 rate)
  'deepseek-v3': { inputPricePer1M: 0.07, outputPricePer1M: 0.28 },
  'deepseek-v4': { inputPricePer1M: 0.14, outputPricePer1M: 0.56 },
  'deepseek-v4-pro': { inputPricePer1M: 0.14, outputPricePer1M: 0.56 },
  'deepseek-r1': { inputPricePer1M: 0.14, outputPricePer1M: 0.56 },
  'deepseek-chat': { inputPricePer1M: 0.07, outputPricePer1M: 0.28 },
}

let customPricing: Record<string, ModelPricing> = {}

export function setCustomPricing(pricing: Record<string, ModelPricing>): void {
  customPricing = pricing
}

export function getModelPricing(model: string): ModelPricing {
  const key = model.toLowerCase()
  return customPricing[key] || DEFAULT_PRICING[key] || { inputPricePer1M: 0, outputPricePer1M: 0 }
}

export function listKnownModels(): string[] {
  return Array.from(new Set([...Object.keys(DEFAULT_PRICING), ...Object.keys(customPricing)]))
}
