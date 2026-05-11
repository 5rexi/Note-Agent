/**
 * Tests for the escalation-decision logic. The full WebFetchTool needs
 * network/Electron — those run separately. These focus on the pure parts.
 */
import { describe, it, expect } from 'bun:test'
import { extractTextFromHtml } from './webFetch'

describe('extractTextFromHtml — link/heading preservation', () => {
  it('inlines anchor href as `text (url)`', () => {
    const html = '<p>See <a href="https://example.com/docs">docs</a> for more.</p>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('docs (https://example.com/docs)')
  })

  it('drops the href duplication when text equals url', () => {
    const html = '<p><a href="https://example.com">https://example.com</a></p>'
    const text = extractTextFromHtml(html)
    // We render only once, not "https://example.com (https://example.com)"
    expect(text).toContain('https://example.com')
    expect(text.match(/https:\/\/example\.com/g)?.length).toBeLessThanOrEqual(1)
  })

  it('drops empty anchors', () => {
    const html = '<a href="https://x.com"></a><p>Body</p>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('Body')
    expect(text).not.toContain('https://x.com')
  })

  it('preserves heading hierarchy as markdown', () => {
    const html = '<h1>Title</h1><h2>Section</h2><h3>Subsection</h3><p>Text</p>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('# Title')
    expect(text).toContain('## Section')
    expect(text).toContain('### Subsection')
  })

  it('handles list items as separate lines', () => {
    const html = '<ul><li>One</li><li>Two</li></ul>'
    const text = extractTextFromHtml(html)
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines).toContain('One')
    expect(lines).toContain('Two')
  })
})
