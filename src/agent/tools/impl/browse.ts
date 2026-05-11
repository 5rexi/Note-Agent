/**
 * BrowseTool — multi-step browser automation backed by the browser-host.
 *
 * Single tool with an `action` discriminator. The model issues one
 * action per call; each call can read or modify a session-scoped page
 * that persists across calls within the same agent session.
 *
 * Use this when interaction is required:
 *   - clicking through pagination / "load more"
 *   - submitting a form / search
 *   - reading content gated behind a click
 *   - any flow where step N depends on step N-1's rendered state
 *
 * For one-shot reads of a known URL, prefer `webFetch` (cheaper, no
 * persistent browser tab). For finding pages, prefer `webSearch`.
 *
 * Permissions:
 *   - explore mode: navigate / observe / extract / screenshot / wait /
 *     scroll / back / forward only — no mutations
 *   - ask mode: prompts on click/type/submit (state-changing actions)
 *   - execute mode: all actions allowed
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult, PermissionResult } from '../../types'
import { getBrowserHost } from '../../browser/types'
import type { PageHandle } from '../../browser/types'
import { renderObserve, findByText } from '../../web/observe'
import { renderA11yTree } from '../../browser/compactA11y'

/* -------------------------------------------------------------------------- */
/* Input schema — discriminated union                                          */
/* -------------------------------------------------------------------------- */

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('navigate'),
    url: z.string().describe('Full URL including protocol'),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  z.object({
    action: z.literal('observe'),
  }).describe('List interactive elements (links/buttons/inputs) with refs the model can pass to click/type'),
  z.object({
    action: z.literal('extract'),
    mode: z.enum(['markdown', 'a11y', 'innerText']).optional().describe('markdown=Readability output (default), a11y=full structured tree, innerText=raw body text'),
    maxChars: z.number().int().positive().max(20_000).optional(),
  }),
  z.object({
    action: z.literal('click'),
    ref: z.string().optional().describe('Element ref returned by `observe` (e.g. "ax:42") — preferred'),
    text: z.string().optional().describe('Visible text fallback when no ref is available; matches case-insensitively'),
  }),
  z.object({
    action: z.literal('type'),
    ref: z.string().describe('Element ref of the text input'),
    text: z.string().describe('Text to type. Replaces existing value.'),
  }),
  z.object({
    action: z.literal('submit'),
    ref: z.string().optional().describe('Optional ref of an element inside the form to submit'),
  }),
  z.object({
    action: z.literal('scroll'),
    direction: z.enum(['up', 'down']),
    amount: z.number().int().positive().max(5000).optional(),
  }),
  z.object({
    action: z.literal('screenshot'),
    ref: z.string().optional().describe('Optional ref to clip to a single element'),
  }),
  z.object({
    action: z.literal('wait'),
    ms: z.number().int().positive().max(15_000).optional(),
    selector: z.string().optional().describe('CSS selector to wait for'),
    timeoutMs: z.number().int().positive().max(15_000).optional(),
  }),
  z.object({ action: z.literal('back') }),
  z.object({ action: z.literal('forward') }),
  z.object({ action: z.literal('close') }).describe('Release the session\'s browser tab'),
])

type Input = z.infer<typeof inputSchema>

interface BrowseSuccessOutput {
  url: string
  /** Action-specific payload. */
  result?: unknown
}

const STATE_CHANGING_ACTIONS = new Set(['click', 'type', 'submit'])

/* -------------------------------------------------------------------------- */
/* Helpers                                                                       */
/* -------------------------------------------------------------------------- */

function requireSessionId(ctx: ToolContext): string {
  if (!ctx.sessionId) {
    throw new Error('browse requires an agent session — no sessionId on ToolContext')
  }
  return ctx.sessionId
}

async function getOrCreatePage(ctx: ToolContext): Promise<PageHandle> {
  const host = getBrowserHost()
  if (!host) throw new Error('browser-host not registered (running outside Electron?)')
  if (!host.isAvailable()) throw new Error(`browser-host unavailable: ${host.unavailableReason()}`)
  const sid = requireSessionId(ctx)
  return host.acquireSession(sid)
}

/**
 * Resolve a click/type target to a backendNodeId by ref or text.
 * Caches the latest a11y snapshot to avoid double-fetching.
 */
/**
 * Poll the page URL after a navigating action. Returns as soon as the URL
 * differs from `before` or `timeoutMs` elapses, whichever comes first.
 */
async function waitForUrlChange(page: PageHandle, before: string, timeoutMs: number): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const cur = page.getUrl()
    if (cur && cur !== before) return cur
    await new Promise((r) => setTimeout(r, 50))
  }
  return page.getUrl()
}

async function resolveTarget(page: PageHandle, opts: { ref?: string; text?: string }): Promise<{ backendNodeId: number; resolvedRef: string }> {
  if (!opts.ref && !opts.text) {
    throw new Error('click/type require either `ref` or `text`')
  }
  const snap = await page.getCompactA11y()
  if (opts.ref) {
    const node = snap.nodes.find((n) => n.ref === opts.ref)
    if (!node) throw new Error(`ref "${opts.ref}" not found — try calling observe again, refs are valid only for the current page snapshot`)
    if (node.backendNodeId === undefined) throw new Error(`ref "${opts.ref}" has no DOM node (decorative element?)`)
    return { backendNodeId: node.backendNodeId, resolvedRef: opts.ref }
  }
  // text fallback
  const node = findByText(snap, opts.text!)
  if (!node) throw new Error(`no interactive element matches text "${opts.text}"`)
  if (node.backendNodeId === undefined) throw new Error(`matched element has no DOM node`)
  return { backendNodeId: node.backendNodeId, resolvedRef: node.ref }
}

/* -------------------------------------------------------------------------- */
/* Tool                                                                          */
/* -------------------------------------------------------------------------- */

export const BrowseTool: Tool<Input, BrowseSuccessOutput> = {
  name: 'browse',
  description:
    'Drive a hidden browser to read or interact with web pages across multiple steps. ' +
    'Single tool with an `action` discriminator. The browser tab persists across calls within the same agent session.\n\n' +
    'Common flow:\n' +
    '  1. {action:"navigate", url}                 — load a page\n' +
    '  2. {action:"observe"}                       — see interactive elements with refs\n' +
    '  3. {action:"click", ref:"ax:42"}            — click by ref (or {text:"Sign in"})\n' +
    '  4. {action:"extract", mode:"markdown"}      — read the page\n' +
    '  5. {action:"close"}                         — release the tab when done\n\n' +
    'Use this only when interaction is required (click, fill form, paginate). For reading a known URL, use webFetch.',
  inputSchema,
  aliases: ['browser'],

  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  isDestructive() { return true },

  checkPermissions(input, ctx): PermissionResult {
    const isMutation = STATE_CHANGING_ACTIONS.has(input.action)
    if (ctx.mode === 'explore') {
      if (isMutation) {
        return { result: 'deny', reason: `Explore mode does not allow browse "${input.action}" — it changes page state` }
      }
      return { result: 'allow' }
    }
    if (ctx.mode === 'ask' && isMutation) {
      const desc = input.action === 'navigate'
        ? `Navigate browser to: ${(input as any).url}`
        : input.action === 'click'
          ? `Click ${('ref' in input && input.ref) ? input.ref : `text "${(input as any).text}"`}`
          : input.action === 'type'
            ? `Type into ${input.ref}: "${input.text.slice(0, 60)}"`
            : input.action === 'submit'
              ? `Submit form (${input.ref ?? 'first form on page'})`
              : `browse ${input.action}`
      return { result: 'ask', description: desc }
    }
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx: ToolContext): Promise<ToolResult<BrowseSuccessOutput>> {
    // Special case: `close` doesn't need an active page.
    if (input.action === 'close') {
      const host = getBrowserHost()
      const sid = ctx.sessionId
      if (host && sid) await host.releaseSession(sid).catch(() => {})
      return { data: { url: '', result: 'closed' }, preview: 'browser tab closed' }
    }

    let page: PageHandle
    try {
      page = await getOrCreatePage(ctx)
    } catch (err: any) {
      return { data: { url: '' }, error: err.message }
    }

    try {
      switch (input.action) {
        case 'navigate': {
          await page.navigate(input.url, { waitUntil: input.waitUntil ?? 'load' })
          const title = await page.getTitle().catch(() => '')
          return {
            data: { url: page.getUrl(), result: { title } },
            preview: `navigated → ${page.getUrl()}${title ? ` (${title.slice(0, 60)})` : ''}`,
          }
        }

        case 'observe': {
          const snap = await page.getCompactA11y()
          const obs = renderObserve(snap)
          return {
            data: { url: page.getUrl(), result: { count: obs.count, view: obs.text } },
            preview: `observed ${obs.count} interactive elements`,
          }
        }

        case 'extract': {
          const mode = input.mode ?? 'markdown'
          const maxChars = input.maxChars ?? 8000
          let text: string
          if (mode === 'markdown') {
            text = await page.getMarkdown(maxChars)
          } else if (mode === 'innerText') {
            text = await page.getInnerText(maxChars)
          } else {
            const snap = await page.getCompactA11y()
            text = renderA11yTree(snap).slice(0, maxChars)
          }
          return {
            data: { url: page.getUrl(), result: { mode, text } },
            preview: `extracted (${mode}, ${text.length} chars)`,
          }
        }

        case 'click': {
          const target = await resolveTarget(page, { ref: input.ref, text: input.text })
          const before = page.getUrl()
          await page.click(target.backendNodeId)
          // Poll-until-change: up to 2s for navigation, exit as soon as URL
          // differs. Cheaper than a fixed wait for non-navigation clicks
          // and more reliable than a too-short fixed wait for cold-DNS hops.
          const after = await waitForUrlChange(page, before, 2000)
          const navigated = before !== after
          return {
            data: { url: after, result: { resolvedRef: target.resolvedRef, navigated } },
            preview: `clicked ${target.resolvedRef}${navigated ? ` → ${after}` : ''}`,
          }
        }

        case 'type': {
          const target = await resolveTarget(page, { ref: input.ref })
          await page.type(target.backendNodeId, input.text)
          return {
            data: { url: page.getUrl(), result: { resolvedRef: target.resolvedRef, typed: input.text.length } },
            preview: `typed ${input.text.length} chars into ${target.resolvedRef}`,
          }
        }

        case 'submit': {
          const before = page.getUrl()
          if (input.ref) {
            const target = await resolveTarget(page, { ref: input.ref })
            await page.submit(target.backendNodeId)
          } else {
            await page.submit()
          }
          const after = await waitForUrlChange(page, before, 3000)
          return {
            data: { url: after, result: { navigated: before !== after } },
            preview: `submitted${before !== after ? ` → ${after}` : ''}`,
          }
        }

        case 'scroll': {
          await page.scroll(input.direction, input.amount)
          return {
            data: { url: page.getUrl(), result: { direction: input.direction, amount: input.amount ?? 600 } },
            preview: `scrolled ${input.direction}`,
          }
        }

        case 'screenshot': {
          let backendNodeId: number | undefined
          if (input.ref) {
            const target = await resolveTarget(page, { ref: input.ref })
            backendNodeId = target.backendNodeId
          }
          const dataB64 = await page.screenshot({ backendNodeId })
          return {
            data: { url: page.getUrl(), result: { format: 'png', base64Bytes: dataB64.length } },
            preview: `screenshot (${dataB64.length} bytes base64)`,
          }
        }

        case 'wait': {
          await page.wait({ ms: input.ms, selector: input.selector, timeoutMs: input.timeoutMs })
          return {
            data: { url: page.getUrl(), result: 'waited' },
            preview: input.selector ? `waited for ${input.selector}` : `waited ${input.ms}ms`,
          }
        }

        case 'back': {
          await page.back()
          await new Promise((r) => setTimeout(r, 400))
          return { data: { url: page.getUrl(), result: 'back' }, preview: `back → ${page.getUrl()}` }
        }
        case 'forward': {
          await page.forward()
          await new Promise((r) => setTimeout(r, 400))
          return { data: { url: page.getUrl(), result: 'forward' }, preview: `forward → ${page.getUrl()}` }
        }

        // close handled above
        default: {
          const _exhaustive: never = input
          return { data: { url: '' }, error: `unknown action: ${(_exhaustive as any).action}` }
        }
      }
    } catch (err: any) {
      return { data: { url: page.getUrl() }, error: err.message }
    }
  },

  renderToolUse(input) {
    if (input.action === 'navigate') return `Browse: navigate to ${input.url}`
    if (input.action === 'click') return `Browse: click ${input.ref ?? `text "${input.text}"`}`
    if (input.action === 'type') return `Browse: type into ${input.ref}`
    if (input.action === 'extract') return `Browse: extract (${input.mode ?? 'markdown'})`
    return `Browse: ${input.action}`
  },
}
