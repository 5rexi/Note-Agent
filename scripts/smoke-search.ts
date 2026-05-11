/**
 * Smoke test: hit each free search backend with one real query and print
 * what came back. Run with `bun run scripts/smoke-search.ts`.
 */
import { searchWithDdgHtml } from '../src/agent/tools/search/ddgHtml'
import { searchWithWikipedia } from '../src/agent/tools/search/wikipedia'
import { searchWithHnAlgolia } from '../src/agent/tools/search/hnAlgolia'
import { WebSearchTool } from '../src/agent/tools/impl/webSearch'

const QUERY = process.argv[2] || 'typescript handbook'

async function tryBackend(name: string, fn: () => Promise<any[]>) {
  console.log(`\n━━━ ${name} ━━━`)
  const t0 = Date.now()
  try {
    const r = await fn()
    const dt = Date.now() - t0
    console.log(`${r.length} result(s) in ${dt}ms`)
    for (const item of r.slice(0, 3)) {
      console.log(`  • ${item.title}`)
      console.log(`    ${item.url}`)
      const s = (item.snippet || '').slice(0, 120)
      if (s) console.log(`    ${s}`)
    }
  } catch (err: any) {
    console.log(`✗ failed: ${err.message}`)
  }
}

async function main() {
  console.log(`Query: "${QUERY}"`)
  await tryBackend('DDG HTML', () => searchWithDdgHtml(QUERY, 5))
  await tryBackend('Wikipedia', () => searchWithWikipedia(QUERY, 3))
  await tryBackend('HN Algolia', () => searchWithHnAlgolia(QUERY, 3))

  console.log('\n━━━ WebSearchTool (full ladder, free-only mode) ━━━')
  const t0 = Date.now()
  const result = await WebSearchTool.call({ query: QUERY }, {
    workspacePath: process.cwd(),
    mode: 'execute',
  } as any)
  const dt = Date.now() - t0
  console.log(`${result.data?.length ?? 0} result(s) in ${dt}ms — preview: ${result.preview ?? '—'}`)
  if (result.error) console.log(`error: ${result.error}`)
  for (const item of (result.data || []).slice(0, 5)) {
    console.log(`  • ${item.title}`)
    console.log(`    ${item.url}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
