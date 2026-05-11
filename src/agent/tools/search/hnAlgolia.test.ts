import { describe, it, expect } from 'bun:test'
import { looksTechnical } from './hnAlgolia'

describe('looksTechnical', () => {
  it('flags language/framework names', () => {
    expect(looksTechnical('typescript decorators stage 3')).toBe(true)
    expect(looksTechnical('how to use React Suspense')).toBe(true)
    expect(looksTechnical('rust ownership rules')).toBe(true)
  })

  it('flags error-message queries', () => {
    expect(looksTechnical('TypeError: Cannot read properties of undefined')).toBe(true)
    expect(looksTechnical('TS2305 module has no exported member')).toBe(true)
  })

  it('flags how-to + dev verbs', () => {
    expect(looksTechnical('how to debug a memory leak in Node')).toBe(true)
  })

  it('skips general-knowledge queries', () => {
    expect(looksTechnical('history of the printing press')).toBe(false)
    expect(looksTechnical('best laptop 2025')).toBe(false)
    expect(looksTechnical('Alan Turing biography')).toBe(false)
  })

  it('skips empty', () => {
    expect(looksTechnical('')).toBe(false)
  })
})
