/**
 * WebFetchTool 测试
 */
import { describe, it, expect } from 'bun:test'
import { extractTextFromHtml } from './webFetch'

describe('extractTextFromHtml', () => {
  it('should extract text from simple HTML', () => {
    const html = '<html><body><p>Hello world</p></body></html>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('Hello world')
  })

  it('should remove script tags', () => {
    const html = '<html><head><script>alert("xss")</script></head><body><p>Content</p></body></html>'
    const text = extractTextFromHtml(html)
    expect(text).not.toContain('alert')
    expect(text).toContain('Content')
  })

  it('should remove style tags', () => {
    const html = '<html><head><style>.red{color:red}</style></head><body><p>Text</p></body></html>'
    const text = extractTextFromHtml(html)
    expect(text).not.toContain('.red')
    expect(text).toContain('Text')
  })

  it('should decode HTML entities', () => {
    const html = '<p>5 &gt; 3 &amp; 2 &lt; 4 &quot;text&quot;</p>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('5 > 3 & 2 < 4')
    expect(text).toContain('"text"')
  })

  it('should handle nested tags', () => {
    const html = '<div><p>Line 1</p><p>Line 2</p></div>'
    const text = extractTextFromHtml(html)
    expect(text).toContain('Line 1')
    expect(text).toContain('Line 2')
  })

  it('should collapse excessive whitespace', () => {
    const html = '<p>  a   b   c  </p>'
    const text = extractTextFromHtml(html)
    expect(text).toBe('a b c')
  })

  it('should handle empty HTML', () => {
    const text = extractTextFromHtml('')
    expect(text).toBe('')
  })

  it('should remove noscript', () => {
    const html = '<noscript>Enable JS</noscript><p>Real content</p>'
    const text = extractTextFromHtml(html)
    expect(text).not.toContain('Enable JS')
    expect(text).toContain('Real content')
  })
})
