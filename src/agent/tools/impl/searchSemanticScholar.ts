import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  query: z.string().describe('Search query for Semantic Scholar papers'),
  maxResults: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default 5)'),
})

type Input = z.infer<typeof inputSchema>

interface S2Paper {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  year: number | null
  citationCount: number
  url: string
  pdfUrl: string | null
}

export const SearchSemanticScholarTool: Tool<Input, { results: S2Paper[] }> = {
  name: 'searchSemanticScholar',
  description: 'Search for academic papers on Semantic Scholar. Covers all scientific domains with citation counts and impact metrics.',
  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input, _ctx: ToolContext): Promise<ToolResult<{ results: S2Paper[] }>> {
    try {
      const maxResults = input.maxResults ?? 5
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(input.query)}&limit=${maxResults}&fields=title,abstract,authors,year,citationCount,openAccessPdf`
      const res = await fetch(url)
      if (!res.ok) {
        return { data: { results: [] }, error: `Semantic Scholar API error: ${res.status}` }
      }
      const data = await res.json()
      const papers = (data.data || []).map((p: any) => ({
        paperId: p.paperId,
        title: p.title || '',
        abstract: p.abstract || '',
        authors: (p.authors || []).map((a: any) => a.name),
        year: p.year || null,
        citationCount: p.citationCount || 0,
        url: `https://www.semanticscholar.org/paper/${p.paperId}`,
        pdfUrl: p.openAccessPdf?.url || null,
      }))

      return { data: { results: papers } }
    } catch (err: any) {
      return { data: { results: [] }, error: err.message || 'Semantic Scholar search failed' }
    }
  },

  renderToolUse(input) {
    return `Search Semantic Scholar: "${input.query}"`
  },
}
