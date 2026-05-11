import { describe, it, expect } from 'bun:test'
import { parseDdgHtml } from './ddgHtml'

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a class="result__a" rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc">Example Page Title</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">A useful snippet about <b>example</b> things.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a class="result__a" rel="nofollow" href="https://direct.example.org/article">Direct Link Result</a>
  </h2>
  <div class="result__snippet">Plain div snippet form.</div>
</div>
`

describe('parseDdgHtml', () => {
  it('parses a redirect-wrapped result', () => {
    const r = parseDdgHtml(SAMPLE_HTML, 5)
    expect(r.length).toBeGreaterThanOrEqual(1)
    expect(r[0].title).toBe('Example Page Title')
    expect(r[0].url).toBe('https://example.com/page')
    expect(r[0].snippet).toContain('useful snippet')
  })

  it('also accepts direct-href and div-form snippet', () => {
    const r = parseDdgHtml(SAMPLE_HTML, 5)
    const direct = r.find((x) => x.url.includes('direct.example.org'))
    expect(direct).toBeDefined()
    expect(direct!.snippet).toContain('Plain div snippet')
  })

  it('honors maxResults cap', () => {
    const r = parseDdgHtml(SAMPLE_HTML, 1)
    expect(r.length).toBe(1)
  })

  it('returns [] for empty input', () => {
    expect(parseDdgHtml('', 5)).toEqual([])
    expect(parseDdgHtml('<html><body>no results</body></html>', 5)).toEqual([])
  })
})
