/**
 * Compact-A11y filter — pure function (no Electron deps), so it can be
 * unit-tested in plain bun.
 *
 * CDP's `Accessibility.getFullAXTree` returns a flat list of nodes that
 * mirrors the rendered tree closely. Useful for screen readers, but
 * a poor fit for an LLM:
 *   - InlineTextBox nodes wrap each line break inside StaticText
 *   - StaticText often duplicates its parent's accessible name
 *   - LayoutTable / generic / none roles add no signal but bulk
 *
 * This filter strips that noise while preserving:
 *   - structure (nesting depth and parent links)
 *   - interactive nodes (so an LLM can pick a click target)
 *   - backend DOM ids (so we can hand off to CDP for click/type)
 */

import type { A11yNode, A11ySnapshot } from './types'

const STRUCTURAL_DROP_ROLES = new Set([
  'InlineTextBox',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
])
const TRANSPARENT_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'group',
  'paragraph',
])
const INTERACTIVE_ROLES = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'option',
])

export interface RawAxNode {
  nodeId: string
  parentId?: string
  childIds?: string[]
  ignored?: boolean
  role?: { value: string }
  name?: { value?: string | null }
  backendDOMNodeId?: number
}

export function compactA11y(rawNodes: RawAxNode[]): A11ySnapshot {
  const byId = new Map(rawNodes.map((n) => [n.nodeId, n]))
  const childrenOfRaw = new Map<string, string[]>()
  for (const n of rawNodes) {
    if (!n.parentId) continue
    if (!childrenOfRaw.has(n.parentId)) childrenOfRaw.set(n.parentId, [])
    childrenOfRaw.get(n.parentId)!.push(n.nodeId)
  }

  const root = rawNodes.find((n) => !n.parentId) || rawNodes[0]
  if (!root) return { nodes: [], rootRef: '' }

  const survivors: A11yNode[] = []
  let nextRef = 0
  const allocRef = () => `ax:${nextRef++}`

  function nameOf(n: RawAxNode): string {
    const v = n.name && n.name.value
    return v ? String(v).replace(/\s+/g, ' ').trim() : ''
  }

  function walk(rawId: string, parentName: string, parentRef: string | undefined): string[] {
    const n = byId.get(rawId)
    if (!n) return []
    const role = n.role?.value
    const ignored = n.ignored
    const name = nameOf(n)
    const rawKids = childrenOfRaw.get(rawId) || []

    if (!ignored && role) {
      if (STRUCTURAL_DROP_ROLES.has(role)) {
        return rawKids.flatMap((k) => walk(k, parentName, parentRef))
      }
      if (role === 'StaticText') {
        if (name && name !== parentName) {
          const ref = allocRef()
          survivors.push({
            ref,
            role,
            name,
            interactive: false,
            backendNodeId: n.backendDOMNodeId,
            childRefs: [],
            parentRef,
          })
          return [ref]
        }
        return []
      }
      if (TRANSPARENT_ROLES.has(role) && !name) {
        return rawKids.flatMap((k) => walk(k, parentName, parentRef))
      }

      const ref = allocRef()
      const node: A11yNode = {
        ref,
        role,
        name,
        interactive: INTERACTIVE_ROLES.has(role),
        backendNodeId: n.backendDOMNodeId,
        childRefs: [],
        parentRef,
      }
      survivors.push(node)
      const childRefs = rawKids.flatMap((k) => walk(k, name, ref))
      node.childRefs = childRefs
      return [ref]
    }
    return rawKids.flatMap((k) => walk(k, parentName, parentRef))
  }

  const rootRefs = walk(root.nodeId, '', undefined)
  return { nodes: survivors, rootRef: rootRefs[0] || '' }
}

/**
 * Render the compact tree as an indented text view — useful for the
 * `observe` action and for debugging.
 */
export function renderA11yTree(snapshot: A11ySnapshot): string {
  const byRef = new Map(snapshot.nodes.map((n) => [n.ref, n]))
  const lines: string[] = []
  function walk(ref: string, depth: number): void {
    const n = byRef.get(ref)
    if (!n) return
    const indent = '  '.repeat(Math.min(depth, 8))
    const tag = n.interactive ? `*[${n.role}]` : `[${n.role}]`
    const tail = n.name ? ` ${n.name.slice(0, 200)}` : ''
    lines.push(`${indent}${n.ref}\t${tag}${tail}`)
    for (const child of n.childRefs) walk(child, depth + 1)
  }
  if (snapshot.rootRef) walk(snapshot.rootRef, 0)
  return lines.join('\n')
}
