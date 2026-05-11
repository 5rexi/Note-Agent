/**
 * Wikipedia search — keyless, fast, perfect for factual lookups.
 *
 * Uses the REST API: https://en.wikipedia.org/w/rest.php/v1/search/page
 * Returns title + extract (a clean ~150-char snippet) + URL.
 *
 * The webSearch tier ladder calls this *in parallel* with DDG/SearXNG when
 * a query looks factual (sniffed by `looksFactual`). The Wikipedia results
 * get merged in front of generic web results — not as a replacement, since
 * "what's the latest version of npm" needs npm.org, not Wikipedia.
 */

import type { SearchResult } from './braveSearch'

const ENDPOINT = 'https://en.wikipedia.org/w/rest.php/v1/search/page'
const REQUEST_TIMEOUT_MS = 6000

interface WikipediaSearchPage {
  id: number
  key: string
  title: string
  excerpt?: string
  description?: string
}
interface WikipediaSearchResponse {
  pages?: WikipediaSearchPage[]
}

export async function searchWithWikipedia(
  query: string,
  maxResults: number = 3,
): Promise<SearchResult[]> {
  const url = new URL(ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(maxResults, 10)))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'note-agent/0.1 (+local research assistant)',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Wikipedia: HTTP ${response.status}`)
    }

    const data = (await response.json()) as WikipediaSearchResponse
    const results: SearchResult[] = []
    for (const page of data.pages || []) {
      if (results.length >= maxResults) break
      const snippet = stripExcerpt(page.excerpt || page.description || '')
      results.push({
        title: page.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
        snippet,
      })
    }
    return results
  } finally {
    clearTimeout(timer)
  }
}

/** Wikipedia excerpt has <span class="searchmatch"> tags around hits — strip. */
function stripExcerpt(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Heuristic: does this query benefit from a Wikipedia hit?
 *
 * True for: short, capitalized, named-entity-ish, no programming verbs,
 *           contains "what is", "who is", "history of", etc.
 * False for: code-flavored ("npm install …"), question-formatted dev queries.
 *
 * False positives are cheap (Wikipedia returns 0 hits for off-topic queries),
 * false negatives just miss a useful result. Tuned to be permissive.
 */
export function looksFactual(query: string): boolean {
  const q = query.trim()
  if (q.length === 0 || q.length > 200) return false

  // Programming/dev signals — skip Wikipedia.
  const devSignals = /\b(npm|pip|cargo|brew|apt|yum|docker|git|kubectl|curl|sudo|sed|awk|grep|stack ?overflow|package\.json|requirements\.txt|tsconfig|webpack|vite|README|404|stderr|stdout|regex|ts2\d{3}|TypeError|ReferenceError)\b/i
  if (devSignals.test(q)) return false

  // Strong factual signals.
  const factualPatterns = [
    /^(what|who|when|where|why|how)\s+(is|was|are|were|did|does)\b/i,
    /\b(history|definition|meaning|origin|biography|timeline)\s+of\b/i,
    /\b(born|died|founded|invented|discovered)\b/i,
  ]
  if (factualPatterns.some((re) => re.test(q))) return true

  // Capitalized multi-word phrase that looks like a proper noun
  const words = q.split(/\s+/)
  if (words.length >= 2 && words.length <= 6) {
    const capWords = words.filter((w) => /^[A-Z][a-z]+/.test(w)).length
    if (capWords >= Math.ceil(words.length * 0.6)) return true
  }

  return false
}
