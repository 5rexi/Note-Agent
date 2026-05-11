import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  query: z.string().describe('Search query for arXiv papers'),
  maxResults: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default 5)'),
})

type Input = z.infer<typeof inputSchema>

interface ArxivEntry {
  id: string
  title: string
  summary: string
  authors: string[]
  published: string
  pdfUrl: string
}

export const SearchArxivTool: Tool<Input, { results: ArxivEntry[] }> = {
  name: 'searchArxiv',
  description: 'Search for academic papers on arXiv. Use this for physics, mathematics, computer science, and related fields.',
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

  async call(input, _ctx: ToolContext): Promise<ToolResult<{ results: ArxivEntry[] }>> {
    try {
      const maxResults = input.maxResults ?? 5
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(input.query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`
      const res = await fetch(url)
      if (!res.ok) {
        return { data: { results: [] }, error: `arXiv API error: ${res.status}` }
      }
      const xml = await res.text()

      const entries: ArxivEntry[] = []
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
      let match: RegExpExecArray | null

      while ((match = entryRegex.exec(xml)) !== null) {
        const entryXml = match[1]
        const idMatch = entryXml.match(/<id>([^<]+)<\/id>/)
        const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/)
        const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/)
        const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/)

        const authors: string[] = []
        const authorRegex = /<name>([^<]+)<\/name>/g
        let authorMatch: RegExpExecArray | null
        while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
          authors.push(authorMatch[1])
        }

        const id = idMatch?.[1] ?? ''
        const arxivId = id.split('/').pop()?.replace('abs/', '') ?? ''

        entries.push({
          id: arxivId,
          title: (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
          summary: (summaryMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
          authors,
          published: publishedMatch?.[1] ?? '',
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        })
      }

      return { data: { results: entries } }
    } catch (err: any) {
      return { data: { results: [] }, error: err.message || 'arXiv search failed' }
    }
  },

  renderToolUse(input) {
    return `Search arXiv: "${input.query}"`
  },
}
