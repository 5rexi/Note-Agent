/**
 * SearXNG meta-search — keyless, JSON output. Opt-in by user-supplied
 * instance URL only.
 *
 * Why opt-in only: public instances aggressively rate-limit anonymous
 * server traffic (we routinely see 429/403 from `searx.be`,
 * `searx.tiekoetter.com`, etc. on first request). Bundling a default
 * instance list creates the impression of free reliable search; in
 * practice it just adds latency before failing.
 *
 * If the user runs their own SearXNG (or trusts a specific public one),
 * they set `searxngEndpoint` in settings and we route through it. No
 * fallback list — fail fast and let the next tier handle it.
 */

import type { SearchResult } from './braveSearch'

const REQUEST_TIMEOUT_MS = 8000

interface SearxngResult {
  title?: string
  url?: string
  content?: string
}
interface SearxngResponse {
  results?: SearxngResult[]
}

export async function searchWithSearxng(
  query: string,
  maxResults: number = 5,
  endpoint: string,
): Promise<SearchResult[]> {
  if (!endpoint) {
    throw new Error('SearXNG endpoint not configured')
  }
  return callSearxng(endpoint, query, maxResults)
}

async function callSearxng(base: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL('/search', base)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('safesearch', '1')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 note-agent/0.1',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = (await response.json()) as SearxngResponse
    const out: SearchResult[] = []
    for (const r of data.results || []) {
      if (out.length >= maxResults) break
      if (!r.title || !r.url) continue
      out.push({
        title: r.title,
        url: r.url,
        snippet: r.content || '',
      })
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

