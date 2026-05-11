/**
 * Browser-tool search — loads a real search engine in a hidden Chromium
 * window via the BrowserHost, then extracts results.
 *
 * Why this works when DDG-HTML / Bing-HTML don't: those endpoints are
 * data-center anti-bot honeypots that serve CAPTCHAs to non-browser
 * clients. Loading the *real* search-engine SPA from a real Chromium
 * sails through anomaly detection.
 *
 * Engines are tried in order until one returns ≥1 result. DDG first
 * because it has cleanest selectors and no JS-required gating; Bing
 * as a backup with different anti-bot characteristics.
 */

import { getBrowserHost } from '../../browser/types'
import type { SearchResult } from './braveSearch'

interface EngineSpec {
  name: string
  url: (q: string) => string
  /** JS evaluated in-page that returns SearchResult[]. */
  extractor: string
}

/**
 * DDG's "real" search page (duckduckgo.com/?q=…) uses a JS-rendered SPA
 * with stable result selectors. We wait for `[data-testid="result"]` to
 * appear, then extract each.
 */
const DDG: EngineSpec = {
  name: 'ddg-browser',
  url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kp=-2`,
  extractor: `(() => {
    const out = [];
    const blocks = document.querySelectorAll('article[data-testid="result"], [data-testid="result"]');
    blocks.forEach((b) => {
      // Title from <h2> textContent (DDG nests obfuscated spans inside, but h2 is stable).
      // The 'a[data-testid="result-title-a"]' anchor sometimes wraps the URL breadcrumb instead
      // of the title — so we read the h2 textContent and pull href from a separate link.
      const h2 = b.querySelector('h2');
      let title = '';
      if (h2) {
        const clone = h2.cloneNode(true);
        for (const u of clone.querySelectorAll('[data-testid="result-extras-url-link"]')) u.remove();
        title = (clone.textContent || '').trim();
      }
      // The destination URL is whichever anchor in the block points off-site.
      // DDG's data-testid links are sometimes "site:" search-filter links, not
      // the actual result URL.
      let url = '';
      for (const a of b.querySelectorAll('a[href]')) {
        const href = a.href || '';
        if (!href) continue;
        if (href.includes('duckduckgo.com')) continue;
        if (href.startsWith('#') || href.startsWith('javascript:')) continue;
        url = href;
        break;
      }
      if (!title || !url) return;
      // Title sometimes contains the URL breadcrumb suffix — strip it.
      title = title.replace(/\\s*https?:\\/\\/[\\S]+$/, '').trim();
      const snippetEl = b.querySelector('[data-testid="result-snippet"], div[data-result="snippet"]');
      const snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
      out.push({ title, url, snippet });
    });
    return out;
  })()`,
}

const BING: EngineSpec = {
  name: 'bing-browser',
  url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  extractor: `(() => {
    const out = [];
    const items = document.querySelectorAll('li.b_algo');
    items.forEach((it) => {
      const link = it.querySelector('h2 > a');
      if (!link) return;
      const title = (link.textContent || '').trim();
      const url = link.href || '';
      if (!title || !url) return;
      const snippetEl = it.querySelector('p, .b_caption p');
      const snippet = snippetEl ? (snippetEl.textContent || '').trim() : '';
      out.push({ title, url, snippet });
    });
    return out;
  })()`,
}

const ENGINES: EngineSpec[] = [DDG, BING]

const NAVIGATION_TIMEOUT_MS = 12_000
const RESULT_WAIT_MS = 5000

export interface BrowserSearchOutcome {
  results: SearchResult[]
  engineUsed?: string
  attempts: { engine: string; ok: boolean; error?: string; count?: number }[]
}

export async function searchWithBrowserTool(query: string, maxResults: number = 5): Promise<BrowserSearchOutcome> {
  const host = getBrowserHost()
  if (!host) throw new Error('browser-host not registered (renderer or pre-init context?)')
  if (!host.isAvailable()) throw new Error(`browser-host unavailable: ${host.unavailableReason()}`)

  const attempts: BrowserSearchOutcome['attempts'] = []
  let page = await host.acquireScratch()
  try {
    for (const engine of ENGINES) {
      try {
        await page.navigate(engine.url(query), { timeoutMs: NAVIGATION_TIMEOUT_MS })

        // Engine-specific result-ready selector.
        const readySelector = engine === DDG ? '[data-testid="result"]' : 'li.b_algo'
        try {
          await page.wait({ selector: readySelector, timeoutMs: RESULT_WAIT_MS })
        } catch {
          // Selector didn't appear in time — extract whatever's there anyway,
          // but tag the attempt so we know.
        }

        const raw = await page.evaluate<SearchResult[]>(engine.extractor)
        const results = Array.isArray(raw) ? raw.slice(0, maxResults) : []
        attempts.push({ engine: engine.name, ok: results.length > 0, count: results.length })
        if (results.length > 0) {
          return { results, engineUsed: engine.name, attempts }
        }
      } catch (err: any) {
        attempts.push({ engine: engine.name, ok: false, error: err.message })
      }
    }
    return { results: [], attempts }
  } finally {
    await host.releaseScratch(page).catch(() => {})
  }
}
