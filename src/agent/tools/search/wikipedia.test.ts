import { describe, it, expect } from 'bun:test'
import { looksFactual } from './wikipedia'

describe('looksFactual', () => {
  it('flags W-questions', () => {
    expect(looksFactual('what is photosynthesis')).toBe(true)
    expect(looksFactual('Who was Alan Turing?')).toBe(true)
    expect(looksFactual('history of the printing press')).toBe(true)
  })

  it('flags proper-noun phrases', () => {
    expect(looksFactual('Alan Turing biography')).toBe(true)
    expect(looksFactual('Roman Empire')).toBe(true)
  })

  it('skips dev/code queries', () => {
    expect(looksFactual('npm install left-pad')).toBe(false)
    expect(looksFactual('TypeScript TS2305 error')).toBe(false)
    expect(looksFactual('how to git rebase --interactive')).toBe(false)
    expect(looksFactual('docker compose up')).toBe(false)
  })

  it('rejects empty / huge queries', () => {
    expect(looksFactual('')).toBe(false)
    expect(looksFactual('a'.repeat(300))).toBe(false)
  })

  it('does not over-fire on lowercase free-form queries', () => {
    expect(looksFactual('cheap flights to portugal')).toBe(false)
    expect(looksFactual('best laptop 2025')).toBe(false)
  })
})
