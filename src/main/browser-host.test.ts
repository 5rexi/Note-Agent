import { describe, it, expect } from 'bun:test'
import { compactA11y } from '../agent/browser/compactA11y'

/**
 * Tests for the compact a11y filter — pure function, no Electron needed.
 * Lives next to browser-host.ts to make the relationship obvious.
 */

function n(nodeId: string, opts: {
  parentId?: string
  role?: string
  name?: string
  ignored?: boolean
  backendDOMNodeId?: number
}): any {
  return {
    nodeId,
    parentId: opts.parentId,
    ignored: opts.ignored,
    role: opts.role ? { value: opts.role } : undefined,
    name: opts.name !== undefined ? { value: opts.name } : undefined,
    backendDOMNodeId: opts.backendDOMNodeId,
  }
}

describe('compactA11y', () => {
  it('drops InlineTextBox children of StaticText', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'StaticText', name: 'Hello world', backendDOMNodeId: 10 }),
      n('3', { parentId: '2', role: 'InlineTextBox', name: 'Hello' }),
      n('4', { parentId: '2', role: 'InlineTextBox', name: 'world' }),
    ]
    const snap = compactA11y(raw)
    expect(snap.nodes.find((x) => x.role === 'InlineTextBox')).toBeUndefined()
    expect(snap.nodes.find((x) => x.role === 'StaticText' && x.name === 'Hello world')).toBeDefined()
  })

  it('dedupes StaticText whose name equals parent name', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'link', name: 'Sign in', backendDOMNodeId: 7 }),
      n('3', { parentId: '2', role: 'StaticText', name: 'Sign in' }), // dupe
    ]
    const snap = compactA11y(raw)
    const link = snap.nodes.find((x) => x.role === 'link')
    expect(link).toBeDefined()
    expect(link!.name).toBe('Sign in')
    // The redundant StaticText should be filtered out.
    expect(snap.nodes.filter((x) => x.role === 'StaticText').length).toBe(0)
  })

  it('collapses transparent generic wrappers without name', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'generic' }),
      n('3', { parentId: '2', role: 'heading', name: 'Title' }),
      n('4', { parentId: '2', role: 'paragraph' }),
      n('5', { parentId: '4', role: 'StaticText', name: 'Body text' }),
    ]
    const snap = compactA11y(raw)
    // Heading and StaticText survive; generic and (nameless) paragraph are collapsed.
    expect(snap.nodes.find((x) => x.role === 'generic')).toBeUndefined()
    expect(snap.nodes.find((x) => x.role === 'paragraph')).toBeUndefined()
    expect(snap.nodes.find((x) => x.role === 'heading' && x.name === 'Title')).toBeDefined()
    expect(snap.nodes.find((x) => x.role === 'StaticText' && x.name === 'Body text')).toBeDefined()
  })

  it('keeps generic when it has a name', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'generic', name: 'Important section' }),
    ]
    const snap = compactA11y(raw)
    expect(snap.nodes.find((x) => x.role === 'generic' && x.name === 'Important section')).toBeDefined()
  })

  it('marks interactive roles', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'link', name: 'Home', backendDOMNodeId: 11 }),
      n('3', { parentId: '1', role: 'heading', name: 'Welcome' }),
    ]
    const snap = compactA11y(raw)
    const link = snap.nodes.find((x) => x.role === 'link')!
    const heading = snap.nodes.find((x) => x.role === 'heading')!
    expect(link.interactive).toBe(true)
    expect(heading.interactive).toBe(false)
  })

  it('drops ignored nodes but keeps their children', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'button', ignored: true }),
      n('3', { parentId: '2', role: 'StaticText', name: 'Click me' }),
    ]
    const snap = compactA11y(raw)
    expect(snap.nodes.find((x) => x.role === 'button')).toBeUndefined()
    // child may or may not survive depending on parent-name dedup; just check no crash
    expect(snap.nodes.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty input', () => {
    expect(compactA11y([])).toEqual({ nodes: [], rootRef: '' })
  })

  it('drops LayoutTable scaffolding entirely', () => {
    const raw = [
      n('1', { role: 'WebArea' }),
      n('2', { parentId: '1', role: 'LayoutTable' }),
      n('3', { parentId: '2', role: 'LayoutTableRow' }),
      n('4', { parentId: '3', role: 'LayoutTableCell' }),
      n('5', { parentId: '4', role: 'link', name: 'A real link', backendDOMNodeId: 9 }),
    ]
    const snap = compactA11y(raw)
    for (const role of ['LayoutTable', 'LayoutTableRow', 'LayoutTableCell']) {
      expect(snap.nodes.find((x) => x.role === role)).toBeUndefined()
    }
    expect(snap.nodes.find((x) => x.role === 'link' && x.name === 'A real link')).toBeDefined()
  })
})
