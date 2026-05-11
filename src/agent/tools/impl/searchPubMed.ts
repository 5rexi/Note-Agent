import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  query: z.string().describe('Search query for PubMed / Europe PMC biomedical papers'),
  maxResults: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default 5)'),
})

type Input = z.infer<typeof inputSchema>

interface PubMedPaper {
  id: string
  title: string
  abstract: string
  authors: string[]
  journal: string
  year: string
  url: string
}

export const SearchPubMedTool: Tool<Input, { results: PubMedPaper[] }> = {
  name: 'searchPubMed',
  description: 'Search for biomedical and life sciences papers on PubMed via Europe PMC. Use this for medicine, biology, genetics, and health-related queries.',
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

  async call(input, _ctx: ToolContext): Promise<ToolResult<{ results: PubMedPaper[] }>> {
    try {
      const maxResults = input.maxResults ?? 5
      // Europe PMC is a free alternative to PubMed with no API key required
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(input.query)}&pageSize=${maxResults}&format=json&resultType=core`
      const res = await fetch(url)
      if (!res.ok) {
        return { data: { results: [] }, error: `Europe PMC API error: ${res.status}` }
      }
      const data = await res.json()
      const results = (data.resultList?.result || []).map((r: any) => ({
        id: r.id || r.pmid || '',
        title: r.title || '',
        abstract: r.abstractText || '',
        authors: (r.authorList?.author || []).map((a: any) => a.fullName || a.collectiveName).filter(Boolean),
        journal: r.journalTitle || '',
        year: r.pubYear || '',
        url: r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : (r.doi ? `https://doi.org/${r.doi}` : ''),
      }))

      return { data: { results } }
    } catch (err: any) {
      return { data: { results: [] }, error: err.message || 'PubMed search failed' }
    }
  },

  renderToolUse(input) {
    return `Search PubMed: "${input.query}"`
  },
}
