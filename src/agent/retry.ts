/**
 * API 错误分类 + 指数退避重试 + 降级策略
 */
import type { LLMConfig } from './types'

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryableStatusCodes: number[]
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
}

export type APIErrorCategory =
  | 'rate-limit'      // 429
  | 'server-error'    // 5xx
  | 'network'         // fetch 失败 / ECONNRESET
  | 'auth'            // 401 / 403
  | 'bad-request'     // 400 / 422
  | 'token-limit'     // max_tokens / context length exceeded
  | 'unknown'

export interface ClassifiedError {
  category: APIErrorCategory
  retryable: boolean
  message: string
  statusCode?: number
}

/**
 * 对 API 错误进行分类
 */
export function classifyError(err: any): ClassifiedError {
  const message = err?.message || String(err)

  // Network errors
  if (
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    err?.cause?.code === 'ECONNRESET'
  ) {
    return { category: 'network', retryable: true, message }
  }

  // HTTP status code
  const status = err?.status || err?.statusCode
  if (status) {
    if (status === 429) {
      return { category: 'rate-limit', retryable: true, message, statusCode: status }
    }
    if (status >= 500) {
      return { category: 'server-error', retryable: true, message, statusCode: status }
    }
    if (status === 401 || status === 403) {
      return { category: 'auth', retryable: false, message, statusCode: status }
    }
    if (status === 400 || status === 422) {
      return { category: 'bad-request', retryable: false, message, statusCode: status }
    }
  }

  // Message-based classification (fallback)
  if (message.includes('429') || message.includes('rate limit')) {
    return { category: 'rate-limit', retryable: true, message }
  }
  if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
    return { category: 'auth', retryable: false, message }
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { category: 'network', retryable: true, message }
  }
  // Token limit errors: can be resolved by reducing prompt or increasing max_tokens
  if (
    message.includes('max_tokens') ||
    message.includes('context length') ||
    message.includes('token limit') ||
    message.includes('too long') ||
    message.includes('prompt is too long')
  ) {
    return { category: 'token-limit', retryable: true, message }
  }

  return { category: 'unknown', retryable: false, message }
}

/**
 * 指数退避延迟计算
 */
export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt)
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, config.maxDelayMs)
}

/**
 * 异步延迟
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带重试的异步函数包装器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: ClassifiedError, delay: number) => void,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: any

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const classified = classifyError(err)

      if (!classified.retryable || attempt >= cfg.maxRetries) {
        throw err
      }

      const delay = calculateDelay(attempt, cfg)
      onRetry?.(attempt + 1, classified, delay)
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * 创建带重试的 LLM 客户端配置
 * 如果主模型失败，降级到 fallbackModel
 */
export function createRetryConfig(config: LLMConfig): RetryConfig {
  return {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 3,
  }
}
