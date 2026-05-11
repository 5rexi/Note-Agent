/**
 * DuckDuckGo HTML endpoint — keyless, no-JS search.
 *
 * `https://html.duckduckgo.com/html/?q=…` returns a server-rendered results
 * page. Lightweight (~50KB), stable selectors, no rate-limit issues for
 * reasonable use. Replaces the Puppeteer-based DDG tier — same data, ~5×
 * faster, no Chromium dependency.
 */

import type { SearchResult } from './braveSearch'

const ENDPOINT = 'https://html.duckduckgo.com/html/'
const REQUEST_TIMEOUT_MS = 8000

export async function searchWithDdgHtml(
  query: string,
  maxResults: number = 5,
): Promise<SearchResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const body = new URLSearchParams({ q: query }).toString()
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`DDG HTML: HTTP ${response.status}`)
    }

    const html = await response.text()
    return parseDdgHtml(html, maxResults)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * DDG-HTML's result block looks roughly like:
 *   <h2 class="result__title">
 *     <a class="result__a" href="//duckduckgo.com/l/?uddg=…">Title</a>
 *   </h2>
 *   <a class="result__snippet" href="…">Snippet text</a>
 *
 * Block-scoping by <div class="result"> is fragile because DDG sometimes
 * nests another <div> inside and sometimes doesn't. Instead we iterate the
 * `result__a` links directly and pair each with the nearest following
 * `result__snippet` within a small lookahead window.
 */
export function parseDdgHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []

  const linkRe = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const SNIPPET_LOOKAHEAD_BYTES = 2000

  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    if (results.length >= maxResults) break

    const url = unwrapDdgRedirect(decodeHtml(m[1]))
    const title = stripTags(m[2]).trim()
    if (!title || !url) continue

    const after = html.slice(m.index + m[0].length, m.index + m[0].length + SNIPPET_LOOKAHEAD_BYTES)
    const snippetAnchor = after.match(/<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    const snippetDiv = !snippetAnchor
      ? after.match(/<div[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      : null
    const snippet = snippetAnchor
      ? stripTags(snippetAnchor[1]).trim()
      : (snippetDiv ? stripTags(snippetDiv[1]).trim() : '')

    results.push({ title, url, snippet })
  }

  return results
}

/**
 * DDG wraps result links in a redirect: `//duckduckgo.com/l/?uddg=<encoded>`.
 * Unwrap it. Also strip the protocol-relative prefix Browsers add.
 */
function unwrapDdgRedirect(href: string): string {
  let url = href.trim()
  if (url.startsWith('//')) url = 'https:' + url
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') {
      const real = u.searchParams.get('uddg')
      if (real) return decodeURIComponent(real)
    }
    return url
  } catch {
    return url
  }
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, ''))
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
}
