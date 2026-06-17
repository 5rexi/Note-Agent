/**
 * WebFetchTool — fetch a URL and return clean text.
 *
 * Auto-escalating tier ladder (the model never picks the engine):
 *
 *   Tier 1  native fetch + heuristic extraction        — ~100ms, free
 *     Escalates when:
 *       - HTTP 4xx / 5xx
 *       - extracted text < 500 chars and HTML has SPA markers
 *       - body contains anti-bot keywords ("checking your browser", "cloudflare")
 *       - content-type is HTML but body is empty / JS-only shell
 *
 *   Tier 2  browser-host CDP page (Readability inside the page) — ~1-2s
 *     Used when Tier 1 escalates AND the host is available.
 *
 *   Tier 3  paid scraper (ScrapingBee / Firecrawl / etc.)
 *     Reserved — wired later in W5 when settings UI grows the keys.
 *
 * Non-HTML responses (JSON, plain text) skip the escalation entirely —
 * they pass through Tier 1 as-is.
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { getBrowserHost } from '../../browser/types'

const inputSchema = z.object({
  url: z.string().describe('Full URL to fetch'),
  maxChars: z.number().int().positive().optional().describe('Maximum characters to return (default 10000)'),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_MAX_CHARS = 10_000
const ESCALATE_BELOW_CHARS = 500
const FETCH_TIMEOUT_MS = 12_000

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/* -------------------------------------------------------------------------- */
/* Native HTML→text extraction                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Strip and decode HTML to mostly-clean text. Preserves block boundaries
 * (paragraphs, headings, list items) and keeps anchor text+href visible
 * so the LLM can follow links from the result.
 *
 * Not as good as Mozilla Readability — that's the Tier 2 escalation.
 */
export function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')

  // Inline anchors as `text (href)` — preserves outbound links.
  text = text.replace(
    /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const cleanInner = inner.replace(/<[^>]+>/g, '').trim()
      if (!cleanInner) return ''
      // If the inner already looks like the href, don't duplicate.
      if (cleanInner === href) return cleanInner
      return `${cleanInner} (${href})`
    },
  )

  // Headings → markdown-ish for LLM hint
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n')

  text = text
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')

  text = text.replace(/<[^>]+>/g, '')

  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")

  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return text
}

/* -------------------------------------------------------------------------- */
/* Escalation triggers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether Tier 1's output is good enough or whether Tier 2 needs
 * to run. Conservative on escalation — escalating costs ~1-2s of CDP work,
 * so only do it when there's clear signal that Tier 1 came up short.
 */
function shouldEscalate(html: string, extracted: string, status: number): { escalate: boolean; reason?: string } {
  if (status >= 400) {
    return { escalate: true, reason: `HTTP ${status}` }
  }

  // Anti-bot challenge pages are uniformly *small* — the whole point is to
  // serve a brief challenge-form HTML and nothing else. We only flag the
  // marker when the entire response is short, otherwise the keyword is
  // almost certainly in article content (Wikipedia, news pages, etc.).
  if (html.length < 8000) {
    const isChallenge =
      /(cloudflare|just a moment|checking your browser|attention required\s*\|\s*cloudflare|hcaptcha|recaptcha|please enable javascript and cookies)/i.test(
        html.slice(0, 4000),
      )
    if (isChallenge) {
      return { escalate: true, reason: 'anti-bot challenge detected' }
    }
  }

  // SPA detection: very thin extracted text but HTML body is full of <script>.
  if (extracted.length < ESCALATE_BELOW_CHARS) {
    const scriptMatches = html.match(/<script\b/gi)
    const scriptCount = scriptMatches ? scriptMatches.length : 0
    const hasEmptyRoot = /<div[^>]+id="(root|app|__next|main)"[^>]*>\s*<\/div>/i.test(html)
    if (scriptCount >= 5 || hasEmptyRoot) {
      return { escalate: true, reason: `SPA shell (${extracted.length} chars, ${scriptCount} scripts)` }
    }
  }

  return { escalate: false }
}

/* -------------------------------------------------------------------------- */
/* Tier 1: native fetch                                                         */
/* -------------------------------------------------------------------------- */

interface NativeOutcome {
  text: string
  status: number
  contentType: string
  escalate: boolean
  reason?: string
}

async function fetchWithNative(url: string, maxChars: number, parentSignal?: AbortSignal): Promise<NativeOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  // Honor the turn's abort signal in addition to the fetch timeout.
  const onParentAbort = () => controller.abort()
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort()
    else parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const contentType = response.headers.get('content-type') || ''
    const body = await response.text()

    // Non-HTML: return as-is (with optional pretty-print for JSON), no escalation.
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(body)
        const pretty = JSON.stringify(parsed, null, 2)
        return { text: pretty.slice(0, maxChars), status: response.status, contentType, escalate: false }
      } catch {
        return { text: body.slice(0, maxChars), status: response.status, contentType, escalate: false }
      }
    }
    if (!contentType.includes('html') && contentType.length > 0) {
      // Plain text, XML, etc. — pass through.
      return { text: body.slice(0, maxChars), status: response.status, contentType, escalate: false }
    }

    const extracted = extractTextFromHtml(body)
    const decision = shouldEscalate(body, extracted, response.status)
    return {
      text: extracted.slice(0, maxChars),
      status: response.status,
      contentType,
      escalate: decision.escalate,
      reason: decision.reason,
    }
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

/* -------------------------------------------------------------------------- */
/* Tier 2: browser-host                                                         */
/* -------------------------------------------------------------------------- */

async function fetchWithBrowser(url: string, maxChars: number): Promise<string> {
  const host = getBrowserHost()
  if (!host) throw new Error('browser-host not registered')
  if (!host.isAvailable()) throw new Error(`browser-host unavailable: ${host.unavailableReason()}`)

  const page = await host.acquireScratch()
  try {
    await page.navigate(url, { timeoutMs: 15_000 })
    const md = await page.getMarkdown(maxChars)
    return md
  } finally {
    await host.releaseScratch(page).catch(() => {})
  }
}

/* -------------------------------------------------------------------------- */
/* Tool                                                                          */
/* -------------------------------------------------------------------------- */

export const WebFetchTool: Tool<Input, string> = {
  name: 'webFetch',
  description:
    'Fetch the content of a webpage and return clean extracted text. ' +
    'For static content (docs, articles, JSON APIs) this returns quickly via plain HTTP. ' +
    'For SPA / JS-rendered / anti-bot pages it transparently escalates to a hidden browser. ' +
    'Use this to read documentation, articles, or any web page.',
  inputSchema,
  aliases: ['fetch'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() { return { result: 'allow' } },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, ctx): Promise<ToolResult<string>> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS

    // ─── Tier 1: native fetch + heuristic extraction ───────────────────────
    let nativeOutcome: NativeOutcome | null = null
    let nativeError: string | null = null
    try {
      nativeOutcome = await fetchWithNative(input.url, maxChars, ctx.signal)
    } catch (err: any) {
      nativeError = err.message
    }

    if (nativeOutcome && !nativeOutcome.escalate && nativeOutcome.text.trim().length > 0) {
      const truncated = nativeOutcome.text.length >= maxChars
        ? nativeOutcome.text + '\n\n[…truncated]'
        : nativeOutcome.text
      return {
        data: truncated,
        preview: `Fetched ${input.url} (native, ${nativeOutcome.text.length} chars)`,
      }
    }

    // ─── Tier 2: browser-host (CDP-rendered Readability) ───────────────────
    const host = getBrowserHost()
    if (host && host.isAvailable()) {
      try {
        const text = await fetchWithBrowser(input.url, maxChars)
        if (text.trim().length > 0) {
          const truncated = text.length >= maxChars ? text + '\n\n[…truncated]' : text
          const why = nativeOutcome?.reason
            ? `escalated from native: ${nativeOutcome.reason}`
            : (nativeError ? `native failed: ${nativeError}` : 'browser')
          return {
            data: truncated,
            preview: `Fetched ${input.url} (${why}, ${text.length} chars)`,
          }
        }
      } catch (err: any) {
        // Tier 2 failed — fall through to the best we have from Tier 1.
        const reason = nativeOutcome?.reason ?? nativeError ?? 'unknown'
        if (nativeOutcome && nativeOutcome.text.trim().length > 0) {
          return {
            data: nativeOutcome.text + `\n\n[Browser escalation failed: ${err.message}]`,
            preview: `Fetched ${input.url} (native, browser-fallback failed: ${err.message})`,
          }
        }
        return { data: '', error: `Fetch failed. native: ${reason}; browser: ${err.message}` }
      }
    }

    // ─── No escalation possible — return what we have, or error ────────────
    if (nativeOutcome && nativeOutcome.text.trim().length > 0) {
      return {
        data: nativeOutcome.text,
        preview: `Fetched ${input.url} (native only — browser unavailable: ${host?.unavailableReason() ?? 'no host'})`,
      }
    }

    const why = nativeOutcome?.reason ?? nativeError ?? 'empty response'
    const hint = !host
      ? ' Browser-tool not registered (likely running outside Electron).'
      : !host.isAvailable()
        ? ` Browser-tool unavailable (${host.unavailableReason()}).`
        : ''
    return { data: '', error: `Fetch failed: ${why}.${hint}` }
  },

  renderToolUse(input) {
    return `Fetch webpage: ${input.url}`
  },
}
