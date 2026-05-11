/**
 * Observe — render the page's interactive surface as a compact "click menu"
 * the model can pick from.
 *
 * Output is intentionally small (~30-line ceiling for typical pages):
 *   - one line per interactive node (link, button, textbox, etc.)
 *   - includes the ref the model passes back to `click` / `type`
 *   - groups under section anchors (heading / nav names) for context
 *
 * Distinct from `renderA11yTree` (full tree) — observe is for *acting*,
 * not for reading content.
 */
import type { A11ySnapshot, A11yNode } from '../browser/types'

export interface ObserveResult {
  /** Pretty-printed text view for the LLM. */
  text: string
  /** Number of interactive nodes surfaced. */
  count: number
  /** Refs of interactive nodes, in document order. */
  refs: string[]
}

export function renderObserve(snapshot: A11ySnapshot, opts: { maxLines?: number } = {}): ObserveResult {
  const maxLines = opts.maxLines ?? 60
  const byRef = new Map(snapshot.nodes.map((n) => [n.ref, n]))
  const lines: string[] = []
  const refs: string[] = []

  // Walk in document order. When we hit a heading or named navigation,
  // emit it as a section header so interactive nodes have context.
  function ancestorContext(node: A11yNode): string {
    // Walk up to the nearest landmark/heading ancestor; useful for
    // disambiguating "Sign in (header)" vs "Sign in (footer)".
    let cur: A11yNode | undefined = node
    let depth = 0
    while (cur && depth < 6) {
      const parent: A11yNode | undefined = cur.parentRef ? byRef.get(cur.parentRef) : undefined
      if (!parent) break
      if (
        parent.role === 'navigation' ||
        parent.role === 'banner' ||
        parent.role === 'contentinfo' ||
        parent.role === 'main' ||
        parent.role === 'complementary' ||
        parent.role === 'form'
      ) {
        return parent.name ? `${parent.role}: ${parent.name}` : parent.role
      }
      cur = parent
      depth++
    }
    return ''
  }

  let lastSection = ''
  for (const node of snapshot.nodes) {
    if (lines.length >= maxLines) {
      lines.push(`  …${snapshot.nodes.filter((n) => n.interactive).length - refs.length} more interactive nodes truncated`)
      break
    }
    if (!node.interactive) continue

    const section = ancestorContext(node)
    if (section && section !== lastSection) {
      lines.push(`-- ${section} --`)
      lastSection = section
    }

    const name = node.name.trim().slice(0, 120) || '(unnamed)'
    lines.push(`${node.ref}\t[${node.role}] ${name}`)
    refs.push(node.ref)
  }

  if (refs.length === 0) {
    return {
      text: '(no interactive elements found — the page may have failed to load, or its content is non-interactive)',
      count: 0,
      refs: [],
    }
  }

  return {
    text: lines.join('\n'),
    count: refs.length,
    refs,
  }
}

/**
 * Find an interactive node by visible text — used by `click({ text })`
 * and as a fallback resolver. Matches case-insensitively, prefers exact
 * matches over substring matches.
 */
export function findByText(snapshot: A11ySnapshot, text: string, role?: string): A11yNode | undefined {
  const target = text.trim().toLowerCase()
  if (!target) return undefined

  let exact: A11yNode | undefined
  let prefix: A11yNode | undefined
  let partial: A11yNode | undefined

  for (const node of snapshot.nodes) {
    if (!node.interactive) continue
    if (role && node.role !== role) continue
    const name = node.name.trim().toLowerCase()
    if (!name) continue
    if (name === target) { exact = node; break }
    if (!prefix && name.startsWith(target)) prefix = node
    if (!partial && name.includes(target)) partial = node
  }

  return exact ?? prefix ?? partial
}
