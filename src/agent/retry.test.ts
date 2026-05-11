/**
 * 重试机制测试
 */
import { describe, it, expect } from 'bun:test'
import { classifyError, calculateDelay, withRetry, sleep } from './retry'

describe('classifyError', () => {
  it('should classify rate limit (429)', () => {
    const err = new Error('Rate limited') as any
    err.status = 429
    const c = classifyError(err)
    expect(c.category).toBe('rate-limit')
    expect(c.retryable).toBe(true)
    expect(c.statusCode).toBe(429)
  })

  it('should classify server error (503)', () => {
    const err = new Error('Service unavailable') as any
    err.status = 503
    const c = classifyError(err)
    expect(c.category).toBe('server-error')
    expect(c.retryable).toBe(true)
    expect(c.statusCode).toBe(503)
  })

  it('should classify auth error (401) as non-retryable', () => {
    const err = new Error('Unauthorized') as any
    err.status = 401
    const c = classifyError(err)
    expect(c.category).toBe('auth')
    expect(c.retryable).toBe(false)
  })

  it('should classify auth error (403) as non-retryable', () => {
    const err = new Error('Forbidden') as any
    err.status = 403
    const c = classifyError(err)
    expect(c.category).toBe('auth')
    expect(c.retryable).toBe(false)
  })

  it('should classify bad request (400) as non-retryable', () => {
    const err = new Error('Bad request') as any
    err.status = 400
    const c = classifyError(err)
    expect(c.category).toBe('bad-request')
    expect(c.retryable).toBe(false)
  })

  it('should classify network errors as retryable', () => {
    const cases = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed']
    for (const msg of cases) {
      const c = classifyError(new Error(msg))
      expect(c.category).toBe('network')
      expect(c.retryable).toBe(true)
    }
  })

  it('should classify message-based rate limit', () => {
    const c = classifyError(new Error('rate limit exceeded'))
    expect(c.category).toBe('rate-limit')
    expect(c.retryable).toBe(true)
  })

  it('should classify unknown errors', () => {
    const c = classifyError(new Error('something weird'))
    expect(c.category).toBe('unknown')
    expect(c.retryable).toBe(false)
  })

  it('should classify string input', () => {
    const c = classifyError('random string error')
    expect(c.category).toBe('unknown')
  })
})

describe('calculateDelay', () => {
  it('should increase delay with attempt', () => {
    const d0 = calculateDelay(0, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, retryableStatusCodes: [] })
    const d1 = calculateDelay(1, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, retryableStatusCodes: [] })
    const d2 = calculateDelay(2, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, retryableStatusCodes: [] })

    expect(d0).toBeGreaterThanOrEqual(750)  // 1000 * 0.75
    expect(d0).toBeLessThanOrEqual(1250)    // 1000 * 1.25
    expect(d1).toBeGreaterThanOrEqual(1500) // 2000 * 0.75
    expect(d2).toBeGreaterThanOrEqual(3000) // 4000 * 0.75
  })

  it('should cap at maxDelayMs', () => {
    const d = calculateDelay(10, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, retryableStatusCodes: [] })
    expect(d).toBeLessThanOrEqual(5000)
  })
})

describe('withRetry', () => {
  it('should return result on first success', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  it('should retry on retryable errors', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) {
          const err = new Error('rate limit') as any
          err.status = 429
          throw err
        }
        return 'ok'
      },
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, retryableStatusCodes: [429] },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('should throw after max retries exceeded', async () => {
    let calls = 0
    try {
      await withRetry(
        async () => {
          calls++
          const err = new Error('rate limit') as any
          err.status = 429
          throw err
        },
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, retryableStatusCodes: [429] },
      )
      expect(false).toBe(true) // should not reach here
    } catch (e: any) {
      expect(e.message).toBe('rate limit')
      expect(calls).toBe(3) // initial + 2 retries
    }
  })

  it('should not retry non-retryable errors', async () => {
    let calls = 0
    try {
      await withRetry(
        async () => {
          calls++
          const err = new Error('unauthorized') as any
          err.status = 401
          throw err
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, retryableStatusCodes: [429] },
      )
      expect(false).toBe(true)
    } catch (e: any) {
      expect(calls).toBe(1)
      expect(e.message).toBe('unauthorized')
    }
  })

  it('should call onRetry callback', async () => {
    const retries: Array<{ attempt: number; category: string }> = []
    await withRetry(
      async () => {
        const err = new Error('server error') as any
        err.status = 503
        throw err
      },
      { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100, retryableStatusCodes: [503] },
      (attempt, error) => {
        retries.push({ attempt, category: error.category })
      },
    ).catch(() => {})

    expect(retries.length).toBe(1)
    expect(retries[0].attempt).toBe(1)
    expect(retries[0].category).toBe('server-error')
  })
})
