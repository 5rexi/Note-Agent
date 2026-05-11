/**
 * Hacker News search via the Algolia-hosted public API.
 *
 * Endpoint: https://hn.algolia.com/api/v1/search
 * - No key, no rate-limit issues for normal use
 * - Indexed: HN stories + comments since 2006
 * - Excellent for: technical/programming queries, library names, tooling
 *
 * The webSearch tier ladder fires this in parallel for queries that look
 * tech-flavored (`looksTechnical`). HN hits get merged in front of generic
 * web results, capped to 2 by default so they augment rather than replace.
 */

import type { SearchResult } from './braveSearch'

const ENDPOINT = 'https://hn.algolia.com/api/v1/search'
const REQUEST_TIMEOUT_MS = 6000

interface HnHit {
  objectID: string
  title?: string
  url?: string
  story_text?: string
  author?: string
  points?: number | null
  num_comments?: number | null
}
interface HnSearchResponse {
  hits?: HnHit[]
}

export async function searchWithHnAlgolia(query: string, maxResults: number = 3): Promise<SearchResult[]> {
  const url = new URL(ENDPOINT)
  url.searchParams.set('query', query)
  url.searchParams.set('tags', 'story')
  url.searchParams.set('hitsPerPage', String(Math.min(maxResults, 10)))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'note-agent/0.1',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HN Algolia: HTTP ${response.status}`)
    }
    const data = (await response.json()) as HnSearchResponse
    const out: SearchResult[] = []
    for (const hit of data.hits || []) {
      if (out.length >= maxResults) break
      const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`
      const title = hit.title?.trim() || ''
      if (!title || !url) continue
      const meta: string[] = []
      if (typeof hit.points === 'number') meta.push(`${hit.points}pt`)
      if (typeof hit.num_comments === 'number') meta.push(`${hit.num_comments} comments`)
      const snippetExtra = meta.length > 0 ? `[HN: ${meta.join(', ')}] ` : '[HN] '
      out.push({
        title,
        url,
        snippet: snippetExtra + (hit.story_text || '').slice(0, 200),
      })
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Detects queries where HN is likely to have relevant indexed content.
 * Triggers on: programming verbs, language names, tool/framework names,
 * "how to" + tech words, error messages.
 *
 * Tuned permissive — false positives just mean an empty HN result, which
 * we filter out in the merge step.
 */
const TECH_WORDS = [
  'typescript', 'javascript', 'python', 'rust', 'golang', 'kotlin', 'swift',
  'react', 'vue', 'svelte', 'angular', 'nextjs', 'next\\.js', 'remix', 'vite', 'webpack',
  'node', 'bun', 'deno', 'docker', 'kubernetes', 'k8s', 'terraform',
  'postgres', 'mysql', 'sqlite', 'redis', 'mongodb', 'elasticsearch',
  'graphql', 'rest api', 'websocket', 'grpc',
  'github', 'git ', 'npm ', 'pip ', 'cargo ',
  'tailwind', 'css', 'html5', 'sass',
  'aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify',
  'llm', 'gpt', 'claude', 'openai', 'anthropic', 'transformer',
]
const TECH_RE = new RegExp(`\\b(${TECH_WORDS.join('|')})\\b`, 'i')

export function looksTechnical(query: string): boolean {
  if (!query || query.length === 0) return false
  if (/\b(how to|why does|what is the)\b/i.test(query) && /\b(code|function|library|api|framework|debug|fix|build)\b/i.test(query)) return true
  if (TECH_RE.test(query)) return true
  if (/\b(error|warning|exception|stack ?trace|TypeError|ReferenceError|SyntaxError|RangeError|EvalError|TS\d{4})\b/i.test(query)) return true
  return false
}
