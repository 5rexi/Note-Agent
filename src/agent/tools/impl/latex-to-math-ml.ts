/**
 * LaTeX → MathML → OMML conversion pipeline.
 *
 * Industry-standard two-stage approach:
 *   1. KaTeX renders LaTeX to MathML (excellent LaTeX coverage)
 *   2. mathml2omml converts MathML to Word-native OMML
 *
 * This replaces the hand-written recursive-descent parser in latex-to-math.ts
 * which could not cover the full LaTeX math grammar.
 */

import katex from 'katex'
import { mml2omml } from 'mathml2omml'

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/**
 * Extract the raw `<math>...</math>` element from KaTeX output, stripping
 * wrapper `<span>` and `<annotation>` tags that mathml2omml does not support.
 */
function extractMathML(html: string): string {
  const match = html.match(/<math[\s\S]*?<\/math>/)
  if (match) return match[0]
  // Fallback: if no <math> found, strip known non-MathML wrappers
  return html
    .replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/gi, '')
}

/**
 * Clean up known mathml2omml quirks:
 * - Removes `<w:rPr>...</w:rPr>` (WordprocessingML in OMML is unsupported)
 * - Removes `<m:sty m:val="undefined"/>` produced for unknown mathvariants
 * - Boxes multi-child `<m:sup>` / `<m:sub>` so Word renders them horizontally
 */
function countTopLevelChildren(xml: string): number {
  let depth = 0
  let count = 0
  const tagRegex = /<(m:\w+)(?:\s[^>]*)?>[ \t\n\r]*|<\/(m:\w+)>/g
  let m: RegExpExecArray | null
  while ((m = tagRegex.exec(xml)) !== null) {
    if (m[1]) {
      if (depth === 0) count++
      depth++
    } else if (m[2]) {
      depth--
    }
  }
  return count
}

function postProcessOmml(omml: string): string {
  // Remove WordprocessingML run properties — they are invalid inside OMML
  omml = omml.replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g, '')
  omml = omml.replace(/<w:rPr\b[^>]*\/>/g, '')
  // Remove undefined style markers
  omml = omml.replace(/<m:sty\s+m:val="undefined"\s*\/>/g, '')
  // Box multi-child m:sup so Word doesn't stack them vertically
  omml = omml.replace(/(<m:sup>)([\s\S]*?)(<\/m:sup>)/g, (match, open, content, close) => {
    if (countTopLevelChildren(content.trim()) > 1) {
      return open + '<m:box><m:e>' + content + '</m:e></m:box>' + close
    }
    return match
  })
  // Box multi-child m:sub
  omml = omml.replace(/(<m:sub>)([\s\S]*?)(<\/m:sub>)/g, (match, open, content, close) => {
    if (countTopLevelChildren(content.trim()) > 1) {
      return open + '<m:box><m:e>' + content + '</m:e></m:box>' + close
    }
    return match
  })
  return omml
}

/**
 * Convert LaTeX to a DOM Element containing OMML.
 *
 * @param latex  The LaTeX math expression
 * @param doc    The target Document (for creating namespaced elements)
 * @param displayMode  true for block math ($$...$$), false for inline ($...$)
 */
export function convertLatexToOmml(latex: string, doc: Document, displayMode = false): Element {
  try {
    // 1. LaTeX → MathML (KaTeX)
    const mathmlHtml = katex.renderToString(latex, {
      output: 'mathml',
      throwOnError: false,
      displayMode,
    })

    // If KaTeX couldn't parse it, return a fallback plain-text OMML run
    if (mathmlHtml.includes('katex-error')) {
      return createFallbackOmml(latex, doc)
    }

    const mathml = extractMathML(mathmlHtml)

    // 2. MathML → OMML string
    let ommlStr = mml2omml(mathml)
    if (!ommlStr || ommlStr === 'undefined') {
      return createFallbackOmml(latex, doc)
    }
    ommlStr = postProcessOmml(ommlStr)

    // 3. Parse OMML string into DOM elements
    const parser = new (require('@xmldom/xmldom').DOMParser)()
    const ommlDoc = parser.parseFromString(ommlStr, 'application/xml')
    const oMath = ommlDoc.documentElement

    // 4. Import into the target document with correct namespace
    if (displayMode) {
      const oMathPara = doc.createElementNS(MATH_NS, 'm:oMathPara')
      const importedMath = doc.importNode(oMath, true)
      oMathPara.appendChild(importedMath)
      return oMathPara
    }

    return doc.importNode(oMath, true)
  } catch (e) {
    console.warn('OMML conversion failed, using fallback:', e)
    return createFallbackOmml(latex, doc)
  }
}

/**
 * Fallback: render the raw LaTeX source as a plain-text OMML run.
 */
function createFallbackOmml(latex: string, doc: Document): Element {
  const oMath = doc.createElementNS(MATH_NS, 'm:oMath')
  const mR = doc.createElementNS(MATH_NS, 'm:r')
  const mT = doc.createElementNS(MATH_NS, 'm:t')
  mT.textContent = latex
  mR.appendChild(mT)
  oMath.appendChild(mR)
  return oMath
}
