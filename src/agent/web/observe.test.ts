import { describe, it, expect } from 'bun:test'
import { renderObserve, findByText } from './observe'
import type { A11ySnapshot, A11yNode } from '../browser/types'

function node(ref: string, role: string, name: string, opts: { interactive?: boolean; backendNodeId?: number; parentRef?: string; childRefs?: string[] } = {}): A11yNode {
  return {
    ref,
    role,
    name,
    interactive: opts.interactive ?? false,
    backendNodeId: opts.backendNodeId,
    parentRef: opts.parentRef,
    childRefs: opts.childRefs ?? [],
  }
}

function snapshot(nodes: A11yNode[]): A11ySnapshot {
  return { nodes, rootRef: nodes[0]?.ref ?? '' }
}

describe('renderObserve', () => {
  it('lists only interactive nodes with refs', () => {
    const snap = snapshot([
      node('ax:0', 'WebArea', 'Page', { childRefs: ['ax:1', 'ax:2', 'ax:3'] }),
      node('ax:1', 'heading', 'Welcome', { parentRef: 'ax:0' }),
      node('ax:2', 'link', 'Sign in', { interactive: true, backendNodeId: 11, parentRef: 'ax:0' }),
      node('ax:3', 'button', 'Search', { interactive: true, backendNodeId: 12, parentRef: 'ax:0' }),
    ])
    const obs = renderObserve(snap)
    expect(obs.count).toBe(2)
    expect(obs.refs).toEqual(['ax:2', 'ax:3'])
    expect(obs.text).toContain('ax:2')
    expect(obs.text).toContain('Sign in')
    expect(obs.text).not.toContain('Welcome') // headings aren't interactive
  })

  it('includes section context from navigation/banner ancestors', () => {
    const snap = snapshot([
      node('ax:0', 'WebArea', '', { childRefs: ['ax:1'] }),
      node('ax:1', 'banner', 'Site header', { parentRef: 'ax:0', childRefs: ['ax:2'] }),
      node('ax:2', 'navigation', 'Main', { parentRef: 'ax:1', childRefs: ['ax:3'] }),
      node('ax:3', 'link', 'Home', { interactive: true, backendNodeId: 1, parentRef: 'ax:2' }),
    ])
    const obs = renderObserve(snap)
    // The section header should be present.
    expect(obs.text).toMatch(/-- (navigation|banner)/)
  })

  it('handles empty snapshot', () => {
    const obs = renderObserve(snapshot([node('ax:0', 'WebArea', 'Empty')]))
    expect(obs.count).toBe(0)
    expect(obs.text).toContain('no interactive elements')
  })

  it('caps at maxLines', () => {
    const nodes = [node('ax:0', 'WebArea', 'Page')]
    for (let i = 1; i <= 100; i++) {
      nodes.push(node(`ax:${i}`, 'link', `Link ${i}`, { interactive: true, backendNodeId: i, parentRef: 'ax:0' }))
    }
    const obs = renderObserve(snapshot(nodes), { maxLines: 10 })
    const lines = obs.text.split('\n')
    // Lines emitted ≤ maxLines + the truncation marker line
    expect(lines.length).toBeLessThanOrEqual(11)
  })
})

describe('findByText', () => {
  const snap = snapshot([
    node('ax:0', 'WebArea', 'P'),
    node('ax:1', 'link', 'Sign in', { interactive: true, backendNodeId: 1, parentRef: 'ax:0' }),
    node('ax:2', 'link', 'Sign up', { interactive: true, backendNodeId: 2, parentRef: 'ax:0' }),
    node('ax:3', 'link', 'Sign in to dashboard', { interactive: true, backendNodeId: 3, parentRef: 'ax:0' }),
    node('ax:4', 'button', 'Sign in', { interactive: true, backendNodeId: 4, parentRef: 'ax:0' }),
  ])

  it('prefers exact match', () => {
    // 'Sign in' appears on link ax:1 and button ax:4 — exact wins; first encountered exact returned
    const found = findByText(snap, 'Sign in')
    expect(found?.ref).toBe('ax:1')
  })

  it('falls back to prefix match', () => {
    const found = findByText(snap, 'Sign in to')
    expect(found?.ref).toBe('ax:3')
  })

  it('respects role filter', () => {
    const found = findByText(snap, 'Sign in', 'button')
    expect(found?.ref).toBe('ax:4')
  })

  it('returns undefined on no match', () => {
    expect(findByText(snap, 'logout')).toBeUndefined()
  })

  it('case-insensitive', () => {
    expect(findByText(snap, 'sign IN')?.ref).toBe('ax:1')
  })

  it('handles empty input', () => {
    expect(findByText(snap, '')).toBeUndefined()
    expect(findByText(snap, '   ')).toBeUndefined()
  })

  it('skips non-interactive nodes', () => {
    const s2 = snapshot([
      node('ax:0', 'WebArea', 'P'),
      node('ax:1', 'heading', 'Sign in', { interactive: false, backendNodeId: 1, parentRef: 'ax:0' }),
    ])
    expect(findByText(s2, 'Sign in')).toBeUndefined()
  })
})
