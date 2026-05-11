/**
 * Brave Search API 后端
 *
 * 文档：https://api.search.brave.com/app/documentation/web-search/get-started
 * - 免费 tier：每月 2000 次查询
 * - 延迟：~669ms（Agentic Search 基准测试最快）
 * - 无需 JS 渲染，直接返回结构化 JSON
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface BraveSearchResult {
  web?: {
    results?: Array<{
      title: string
      url: string
      description: string
    }>
  }
}

/**
 * 使用 Brave Search API 搜索
 */
export async function searchWithBrave(
  query: string,
  apiKey: string,
  maxResults: number = 5,
): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(maxResults, 20)))
  url.searchParams.set('offset', '0')
  url.searchParams.set('text_decorations', 'false')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Brave Search API error: HTTP ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`)
  }

  const data = (await response.json()) as BraveSearchResult
  const results: SearchResult[] = []

  for (const item of data.web?.results || []) {
    results.push({
      title: item.title || '',
      url: item.url || '',
      snippet: item.description || '',
    })
  }

  return results
}
