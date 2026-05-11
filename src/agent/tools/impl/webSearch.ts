/**
 * WebSearchTool — layered dispatcher with smart routing.
 *
 * Routing decision (the model never picks the engine):
 *
 *   STRONG specialized match → that source ONLY
 *     - factual ("what is X", "history of X")        → Wikipedia
 *     - technical (TS\d{4}, language-flavored)       → HN Algolia
 *
 *   DEFAULT                                          → browser-tool (CDP)
 *     loads real search-engine SPA in a hidden Chromium and extracts
 *     results. Bypasses CAPTCHAs that block DDG/Bing HTML scraping.
 *
 *   browser-tool unavailable (circuit-breaker / disabled / timeout)
 *     → cascade through legacy free fallbacks:
 *         Brave API (if key + free-only off)
 *         → DDG HTML (best-effort)
 *         → Bing HTML (best-effort)
 *         → SearXNG (if user-configured)
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'
import { searchWithBrave, type SearchResult } from '../search/braveSearch'
import { searchWithDdgHtml } from '../search/ddgHtml'
import { searchWithSearxng } from '../search/searxng'
import { searchWithWikipedia, looksFactual } from '../search/wikipedia'
import { searchWithHnAlgolia, looksTechnical } from '../search/hnAlgolia'
import { searchWithBrowserTool } from '../search/browserSearch'
import { getBrowserHost } from '../../browser/types'

const inputSchema = z.object({
  query: z.string().describe('Search query string'),
  maxResults: z.number().int().positive().max(10).optional().describe('Maximum results to return (default 5)'),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_MAX_RESULTS = 5

interface DbLike {
  getSetting?: (key: string) => string | null
}

function getDb(): DbLike | undefined {
  return (global as any).__db as DbLike | undefined
}

function getSetting(key: string): string | null {
  return getDb()?.getSetting?.(key)?.trim() || null
}

/**
 * Read the free-only flag. Defaults to TRUE — paid tiers (Brave, future
 * Tavily/Exa) are skipped unless the user explicitly turns this off in
 * settings. Encodes "no surprise spending" as the default.
 */
function isFreeOnly(): boolean {
  const v = getSetting('webFreeOnly')
  if (v === null) return true
  return v !== 'false' && v !== '0'
}

async function searchWithBing(query: string, maxResults: number): Promise<SearchResult[]> {
  const htmlUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(htmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()
    return parseBingResults(html).slice(0, maxResults)
  } finally {
    clearTimeout(timeout)
  }
}

function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const blocks: string[] = []
  let idx = 0
  while (true) {
    const start = html.indexOf('<li class="b_algo"', idx)
    if (start === -1) break
    const end = html.indexOf('</li>', start)
    if (end === -1) break
    blocks.push(html.slice(start, end + 5))
    idx = end + 5
  }
  for (const block of blocks) {
    const h2Match = block.match(/<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>.*?<\/h2>/)
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    if (h2Match) {
      const url = unwrapBingRedirect(decodeHtmlEntities(h2Match[1]).trim())
      const title = stripHtml(h2Match[2]).trim()
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : ''
      if (title && url) results.push({ title, url, snippet })
    }
  }
  return results
}

/**
 * Bing wraps result URLs as `https://www.bing.com/ck/a?…&u=a1<b64-url>&…`.
 * The leading `a1` tag is a Bing marker; the remainder is base64-encoded.
 * If parsing fails, return the original URL — better a tracking link than
 * dropping the result.
 */
function unwrapBingRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('bing.com')) return url
    if (u.pathname !== '/ck/a' && u.pathname !== '/ck') return url
    const raw = u.searchParams.get('u')
    if (!raw) return url
    const b64 = raw.startsWith('a1') ? raw.slice(2) : raw
    // base64url-safe → standard
    const std = b64.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(std, 'base64').toString('utf-8')
    if (/^https?:\/\//i.test(decoded)) return decoded
    return url
  } catch {
    return url
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim()
}
function decodeHtmlEntities(t: string): string {
  return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

/**
 * Merge specialized-source hits (Wikipedia, HN) in front of generic
 * results. Each specialized source is capped so it augments rather than
 * replaces. URLs are deduped across sources.
 */
function mergeSpecialized(generic: SearchResult[], specialized: SearchResult[][], maxResults: number): SearchResult[] {
  const head: SearchResult[] = []
  const seen = new Set<string>()
  const headBudget = Math.max(2, Math.floor(maxResults / 2))

  for (const source of specialized) {
    const cap = Math.min(source.length, 2)
    for (let i = 0; i < cap && head.length < headBudget; i++) {
      const r = source[i]
      if (r && !seen.has(r.url)) {
        head.push(r)
        seen.add(r.url)
      }
    }
  }
  const tail = generic.filter((r) => !seen.has(r.url))
  return [...head, ...tail].slice(0, maxResults)
}

interface TierAttempt { name: string; ok: boolean; error?: string }

async function runTierLadder(query: string, maxResults: number, freeOnly: boolean): Promise<{ results: SearchResult[]; attempts: TierAttempt[] }> {
  const attempts: TierAttempt[] = []

  // Tier 1 (paid): Brave
  if (!freeOnly) {
    const braveKey = getSetting('braveSearchApiKey')
    if (braveKey) {
      try {
        const r = await searchWithBrave(query, braveKey, maxResults)
        if (r.length > 0) {
          attempts.push({ name: 'brave', ok: true })
          return { results: r, attempts }
        }
        attempts.push({ name: 'brave', ok: false, error: 'no results' })
      } catch (err: any) {
        attempts.push({ name: 'brave', ok: false, error: err.message })
      }
    }
  }

  // Tier 2 (free, opt-in): SearXNG (only if user configured an endpoint)
  const searxEndpoint = getSetting('searxngEndpoint')
  if (searxEndpoint) {
    try {
      const r = await searchWithSearxng(query, maxResults, searxEndpoint)
      if (r.length > 0) {
        attempts.push({ name: 'searxng', ok: true })
        return { results: r, attempts }
      }
      attempts.push({ name: 'searxng', ok: false, error: 'no results' })
    } catch (err: any) {
      attempts.push({ name: 'searxng', ok: false, error: err.message })
    }
  }

  // Tier 3 (free, best-effort): DDG HTML — often captcha'd on data-center IPs
  try {
    const r = await searchWithDdgHtml(query, maxResults)
    if (r.length > 0) {
      attempts.push({ name: 'ddg-html', ok: true })
      return { results: r, attempts }
    }
    attempts.push({ name: 'ddg-html', ok: false, error: 'no results (captcha?)' })
  } catch (err: any) {
    attempts.push({ name: 'ddg-html', ok: false, error: err.message })
  }

  // Tier 4 (free, best-effort): Bing HTML — also often captcha'd
  try {
    const r = await searchWithBing(query, maxResults)
    if (r.length > 0) {
      attempts.push({ name: 'bing', ok: true })
      return { results: r, attempts }
    }
    attempts.push({ name: 'bing', ok: false, error: 'no results (captcha?)' })
  } catch (err: any) {
    attempts.push({ name: 'bing', ok: false, error: err.message })
  }

  return { results: [], attempts }
}

export const WebSearchTool: Tool<Input, SearchResult[]> = {
  name: 'webSearch',
  description: 'Search the web. Returns title/URL/snippet results. Internally routes through Brave (if configured) → SearXNG (if configured) → DDG/Bing HTML, plus parallel Wikipedia/HN lookups for factual or technical queries. Free anonymous HTML scraping is unreliable and may hit captchas; for guaranteed results, configure a Brave Search API key (free 2K/mo).',
  inputSchema,
  aliases: ['search'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, _ctx): Promise<ToolResult<SearchResult[]>> {
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS
    const freeOnly = isFreeOnly()
    const q = input.query

    // ─── Lane 1: STRONG specialized match → that source ONLY ───────────────
    // Cheap, captcha-immune, and the best result quality for these queries.
    if (looksFactual(q)) {
      try {
        const r = await searchWithWikipedia(q, maxResults)
        if (r.length > 0) {
          return { data: r, preview: `Search "${q}" via wikipedia → ${r.length} results` }
        }
      } catch (err: any) {
        // Fall through to default lane.
        console.warn(`[webSearch] Wikipedia failed for factual query: ${err.message}`)
      }
    }
    if (looksTechnical(q)) {
      try {
        const r = await searchWithHnAlgolia(q, maxResults)
        if (r.length > 0) {
          return { data: r, preview: `Search "${q}" via hn → ${r.length} results` }
        }
      } catch (err: any) {
        console.warn(`[webSearch] HN failed for technical query: ${err.message}`)
      }
    }

    // ─── Lane 2: DEFAULT → browser-tool (CDP-rendered DDG/Bing) ────────────
    const host = getBrowserHost()
    if (host && host.isAvailable()) {
      try {
        const outcome = await searchWithBrowserTool(q, maxResults)
        if (outcome.results.length > 0) {
          return {
            data: outcome.results,
            preview: `Search "${q}" via ${outcome.engineUsed ?? 'browser'} → ${outcome.results.length} results`,
          }
        }
        // 0 results from all browser engines — slip into fallback cascade.
      } catch (err: any) {
        console.warn(`[webSearch] browser-tool failed: ${err.message}`)
      }
    }

    // ─── Lane 3: FALLBACK CASCADE ──────────────────────────────────────────
    const { results: cascade, attempts } = await runTierLadder(q, maxResults, freeOnly)
    if (cascade.length > 0) {
      const tier = attempts.find((a) => a.ok)?.name ?? 'fallback'
      return { data: cascade, preview: `Search "${q}" via ${tier} (fallback) → ${cascade.length} results` }
    }

    const errs = attempts.filter((a) => !a.ok).map((a) => `${a.name}: ${a.error}`).join('; ')
    const hint = !host
      ? ' Browser-tool unavailable (likely running outside Electron).'
      : !host.isAvailable()
        ? ` Browser-tool unavailable (${host.unavailableReason()}).`
        : freeOnly && !getSetting('braveSearchApiKey')
          ? ' Add a Brave Search API key in settings (free 2K/mo) for guaranteed results.'
          : ''
    return { data: [], error: `Search failed. Tried: ${errs}.${hint}` }
  },

  renderToolUse(input) {
    return `Web search: "${input.query}"`
  },
}
