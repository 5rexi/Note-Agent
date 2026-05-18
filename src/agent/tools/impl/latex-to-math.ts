/**
 * Lightweight LaTeX → docx Math / OMML converter.
 * Supports: fractions, superscripts, subscripts, radicals, sums/integrals/limits,
 * Greek letters, common symbols, brackets, accents, text.
 */

// ── Types ──

type TokenType = 'CMD' | 'LBRACE' | 'RBRACE' | 'LBRACKET' | 'RBRACKET' | 'SUPER' | 'SUB' | 'TEXT' | 'SPACE' | 'EOF'

interface Token {
  type: TokenType
  value: string
}

export type AstNode =
  | { type: 'text'; text: string }
  | { type: 'group'; children: AstNode[] }
  | { type: 'cmd'; name: string; args: AstNode[][] }
  | { type: 'supsub'; base: AstNode; sup?: AstNode[]; sub?: AstNode[] }

// ── Symbol Maps ──

const GREEK_MAP: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SYMBOL_MAP: Record<string, string> = {
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', ast: '∗', star: '⋆',
  circ: '∘', bullet: '•', cap: '∩', cup: '∪', uplus: '⊎', sqcap: '⊓', sqcup: '⊔',
  vee: '∨', wedge: '∧', setminus: '∖', cdots: '⋯', ldots: '…', vdots: '⋮',
  ddots: '⋱', leq: '≤', geq: '≥', le: '≤', ge: '≥', ll: '≪', gg: '≫',
  neq: '≠', ne: '≠', approx: '≈', sim: '∼', simeq: '≃', cong: '≅', equiv: '≡',
  propto: '∝', perp: '⊥', parallel: '∥', angle: '∠', triangle: '△', ell: 'ℓ',
  hbar: 'ℏ', infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  neg: '¬', emptyset: '∅', in: '∈', notin: '∉', subset: '⊂', supset: '⊃',
  subseteq: '⊆', supseteq: '⊇', subsetneq: '⊊', supsetneq: '⊋', mid: '∣',
  mapsto: '↦', to: '→', gets: '←', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', iff: '⇔',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  bigcup: '⋃', bigcap: '⋂', lim: 'lim', sin: 'sin', cos: 'cos', tan: 'tan',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', vert: '|', Vert: '‖', backslash: '\\',
  cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin', arccos: 'arccos',
  // Spacing and operators
  quad: '\u2003', qquad: '\u2003\u2003', oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘',
  arctan: 'arctan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', log: 'log',
  ln: 'ln', exp: 'exp', det: 'det', dim: 'dim', ker: 'ker', hom: 'hom',
  max: 'max', min: 'min', sup: 'sup', inf: 'inf', arg: 'arg', deg: 'deg',
  gcd: 'gcd', Pr: 'Pr',
}

// ── Tokenizer ──

export function tokenize(latex: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < latex.length) {
    const ch = latex[i]
    if (ch === '\\') {
      let j = i + 1
      while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++
      if (j === i + 1) {
        tokens.push({ type: 'CMD', value: latex[i + 1] || '' })
        i += 2
      } else {
        tokens.push({ type: 'CMD', value: latex.slice(i + 1, j) })
        i = j
      }
    } else if (ch === '{') {
      tokens.push({ type: 'LBRACE', value: '{' })
      i++
    } else if (ch === '}') {
      tokens.push({ type: 'RBRACE', value: '}' })
      i++
    } else if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: '[' })
      i++
    } else if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ']' })
      i++
    } else if (ch === '^') {
      tokens.push({ type: 'SUPER', value: '^' })
      i++
    } else if (ch === '_') {
      tokens.push({ type: 'SUB', value: '_' })
      i++
    } else if (/\s/.test(ch)) {
      let j = i
      while (j < latex.length && /\s/.test(latex[j])) j++
      tokens.push({ type: 'SPACE', value: ' ' })
      i = j
    } else {
      let j = i
      while (j < latex.length && !/[\{\}\[\]\\^_\s]/.test(latex[j])) j++
      tokens.push({ type: 'TEXT', value: latex.slice(i, j) })
      i = j
    }
  }
  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

// ── Parser ──

export function parseLatex(latex: string): AstNode[] {
  try {
    const tokens = tokenize(latex)
    let pos = 0

    function peek(): Token { return tokens[pos] || { type: 'EOF', value: '' } }
    function consume(): Token { return tokens[pos++] }

    function parseSequence(stopAtRight = false): AstNode[] {
      const nodes: AstNode[] = []
      while (peek().type !== 'EOF' && peek().type !== 'RBRACE' && peek().type !== 'RBRACKET') {
        if (stopAtRight && peek().type === 'CMD' && peek().value === 'right') break
        nodes.push(parseExpr(stopAtRight))
      }
      return nodes
    }

    function parseExpr(stopAtRight = false): AstNode {
      let node = parseAtom(stopAtRight)
      while (peek().type === 'SUPER' || peek().type === 'SUB') {
        const isSuper = peek().type === 'SUPER'
        consume()
        const arg = parseAtom(stopAtRight)
        const argNodes = arg.type === 'group' ? arg.children : [arg]
        if (isSuper) {
          node = { type: 'supsub', base: node, sup: argNodes, sub: (node as any).sub }
        } else {
          node = { type: 'supsub', base: node, sup: (node as any).sup, sub: argNodes }
        }
      }
      return node
    }

    function parseAtom(stopAtRight = false): AstNode {
      const t = peek()
      if (t.type === 'EOF') return { type: 'text', text: '' }
      if (t.type === 'LBRACE') {
        consume()
        const children = parseSequence(stopAtRight)
        if (peek().type === 'RBRACE') consume()
        return { type: 'group', children }
      }
      // Treat plain parentheses / square brackets as implicit grouping
      // so that (T^k)_{ii} applies the subscript to the whole (T^k).
      if (t.type === 'TEXT' && (t.value === '(' || t.value === '[')) {
        const open = t.value
        const close = open === '(' ? ')' : ']'
        consume()
        const children: AstNode[] = []
        while (peek().type !== 'EOF') {
          if (stopAtRight && peek().type === 'CMD' && peek().value === 'right') break
          if (peek().type === 'TEXT' && peek().value === close) {
            consume()
            return { type: 'cmd', name: 'bracket', args: [[{ type: 'text', text: open }, ...children, { type: 'text', text: close }]] }
          }
          children.push(parseExpr(stopAtRight))
        }
        // Unmatched — fall back to plain text for the opening bracket
        return { type: 'text', text: open }
      }
      if (t.type === 'CMD') {
        consume()
        if (stopAtRight && t.value === 'right') {
          return { type: 'cmd', name: 'right', args: [] }
        }
        return parseCommand(t.value, stopAtRight)
      }
      if (t.type === 'TEXT' || t.type === 'SPACE') {
        consume()
        return { type: 'text', text: t.value }
      }
      consume()
      return { type: 'text', text: t.value }
    }

    function parseCommand(name: string, stopAtRight = false): AstNode {
      const args: AstNode[][] = []
      switch (name) {
        case 'frac': case 'binom': case 'dbinom': case 'tbinom':
          args.push(parseGroupOrAtom(stopAtRight))
          args.push(parseGroupOrAtom(stopAtRight))
          break
        case 'sqrt':
          if (peek().type === 'LBRACKET') {
            consume()
            const opt = parseSequence()
            if (peek().type === 'RBRACKET') consume()
            args.push(opt)
          }
          args.push(parseGroupOrAtom(stopAtRight))
          break
        case 'left': {
          const delim = peek()
          let leftDelim = '('
          if (delim.type === 'TEXT' || delim.type === 'LBRACE' || delim.type === 'RBRACE' || delim.type === 'LBRACKET' || delim.type === 'RBRACKET' || delim.type === 'CMD') {
            leftDelim = delim.type === 'CMD' ? '\\' + delim.value : delim.value
            consume()
          }
          const inner: AstNode[] = []
          while (peek().type !== 'EOF') {
            if (peek().type === 'CMD' && peek().value === 'right') {
              consume()
              const rightDelimToken = peek()
              let rightDelim = ')'
              if (rightDelimToken.type === 'TEXT' || rightDelimToken.type === 'LBRACE' || rightDelimToken.type === 'RBRACE' || rightDelimToken.type === 'LBRACKET' || rightDelimToken.type === 'RBRACKET' || rightDelimToken.type === 'CMD') {
                rightDelim = rightDelimToken.type === 'CMD' ? '\\' + rightDelimToken.value : rightDelimToken.value
                consume()
              }
              return { type: 'cmd', name: 'bracket', args: [[{ type: 'text', text: leftDelim }, ...inner, { type: 'text', text: rightDelim }]] }
            }
            inner.push(parseExpr(true))
          }
          return { type: 'cmd', name: 'bracket', args: [[{ type: 'text', text: leftDelim }, ...inner]] }
        }
        case 'overline': case 'underline': case 'hat': case 'bar': case 'vec': case 'tilde': case 'dot': case 'ddot': case 'widehat': case 'widetilde':
          args.push(parseGroupOrAtom(stopAtRight))
          break
        case 'text': case 'mathrm': case 'mathbf': case 'mathit': case 'mathcal': case 'mathbb': case 'mathfrak': case 'mathsf': case 'mathtt':
          args.push(parseTextGroup())
          break
        case 'begin':
          skipGroup()
          while (peek().type !== 'EOF') {
            if (peek().type === 'CMD' && peek().value === 'end') {
              consume()
              skipGroup()
              break
            }
            consume()
          }
          return { type: 'text', text: '' }
        default:
          break
      }
      return { type: 'cmd', name, args }
    }

    function parseGroupOrAtom(stopAtRight = false): AstNode[] {
      if (peek().type === 'LBRACE') {
        consume()
        const children = parseSequence(stopAtRight)
        if (peek().type === 'RBRACE') consume()
        return children
      }
      return [parseAtom(stopAtRight)]
    }

    /**
     * Parse a group as raw text — used for \text, \mathrm etc.
     * Preserves \_, \^, and nested braces as literal characters.
     */
    function parseTextGroup(): AstNode[] {
      if (peek().type !== 'LBRACE') {
        return [parseAtom(false)]
      }
      consume() // {
      let text = ''
      let depth = 1
      while (depth > 0 && peek().type !== 'EOF') {
        if (peek().type === 'LBRACE') {
          depth++
          text += '{'
          consume()
        } else if (peek().type === 'RBRACE') {
          depth--
          if (depth > 0) text += '}'
          consume()
        } else if (peek().type === 'CMD') {
          const cmd = consume().value
          if (cmd === '_') {
            text += '_'
          } else if (cmd === '^') {
            text += '^'
          } else if (cmd === '{' || cmd === '}') {
            text += cmd
          } else {
            text += '\\' + cmd
          }
        } else if (peek().type === 'SUB') {
          text += '_'
          consume()
        } else if (peek().type === 'SUPER') {
          text += '^'
          consume()
        } else {
          text += consume().value
        }
      }
      return [{ type: 'text', text }]
    }

    function skipGroup(): void {
      if (peek().type === 'LBRACE') {
        consume()
        let depth = 1
        while (depth > 0 && peek().type !== 'EOF') {
          if (peek().type === 'LBRACE') depth++
          else if (peek().type === 'RBRACE') depth--
          consume()
        }
      }
    }

    return parseSequence()
  } catch (e) {
    return [{ type: 'text', text: latex }]
  }
}


// ── docx conversion (industry-standard: KaTeX → MathML → OMML) ──

import { DOMImplementation } from '@xmldom/xmldom'

export function convertLatexToDocxMath(latex: string, docx: any): any {
  try {
    const impl = new DOMImplementation()
    const doc = impl.createDocument(
      'http://schemas.openxmlformats.org/officeDocument/2006/math',
      'm:oMath',
      null
    )
    const omml = convertLatexToOmml(latex, doc as unknown as Document)

    const XMLSerializer = require('@xmldom/xmldom').XMLSerializer
    const serializer = new XMLSerializer()
    const xmlStr = serializer.serializeToString(omml)

    const imported = docx.ImportedXmlComponent.fromXmlString(xmlStr)
    return imported.root?.[0] ?? imported
  } catch (e) {
    console.warn('OMML conversion failed, falling back to plain text:', e)
    const { Math, MathRun } = docx
    return new Math({ children: [new MathRun(latex)] })
  }
}

function astNodeToDocx(node: AstNode, docx: any): any[] {
  const {
    MathRun, MathFraction, MathSuperScript, MathSubScript, MathSubSuperScript,
    MathRadical, MathSum, MathIntegral, MathLimitLower,
  } = docx

  switch (node.type) {
    case 'text': {
      const mapped = mapText(node.text)
      return [new MathRun(mapped)]
    }
    case 'group':
      return node.children.flatMap((c) => astNodeToDocx(c, docx))
    case 'supsub': {
      const base = astNodeToDocx(node.base, docx)
      const sup = node.sup ? node.sup.flatMap((c) => astNodeToDocx(c, docx)) : []
      const sub = node.sub ? node.sub.flatMap((c) => astNodeToDocx(c, docx)) : []

      if (node.base.type === 'cmd') {
        switch (node.base.name) {
          case 'sum': case 'prod': {
            return [new MathSum({
              children: [new MathRun(SYMBOL_MAP[node.base.name] || '∑')],
              superScript: sup, subScript: sub,
            })]
          }
          case 'int': case 'iint': case 'iiint': case 'oint': {
            return [new MathIntegral({
              children: [new MathRun(SYMBOL_MAP[node.base.name] || '∫')],
              superScript: sup, subScript: sub,
            })]
          }
          case 'lim': {
            return [new MathLimitLower({
              children: [new MathRun('lim')],
              limit: sub,
            })]
          }
        }
      }

      if (sup.length > 0 && sub.length > 0) {
        return [new MathSubSuperScript({ children: base, superScript: sup, subScript: sub })]
      } else if (sup.length > 0) {
        return [new MathSuperScript({ children: base, superScript: sup })]
      } else if (sub.length > 0) {
        return [new MathSubScript({ children: base, subScript: sub })]
      }
      return base
    }
    case 'cmd': {
      switch (node.name) {
        case 'frac':
          return [new MathFraction({
            numerator: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            denominator: (node.args[1] || []).flatMap((c) => astNodeToDocx(c, docx)),
          })]
        case 'sqrt':
          if (node.args.length === 2) {
            return [new MathRadical({
              children: (node.args[1] || []).flatMap((c) => astNodeToDocx(c, docx)),
              degree: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            })]
          } else {
            return [new MathRadical({
              children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            })]
          }
        case 'bracket': {
          const all = node.args[0] || []
          const leftDelim = (node as any).left || '('
          const rightDelim = (node as any).right || ')'
          return [buildOmmlBracket(
            all.flatMap((c) => astNodeToDocx(c, docx)),
            mapDelimiter(leftDelim),
            mapDelimiter(rightDelim),
            docx
          )]
        }
        case 'overline':
          return [buildOmmlBar(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            'top', docx
          )]
        case 'underline':
          return [buildOmmlBar(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            'bot', docx
          )]
        case 'hat': case 'widehat':
          return [buildOmmlAccent(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            '\u0302', docx
          )]
        case 'bar':
          return [buildOmmlAccent(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            '\u0304', docx
          )]
        case 'vec':
          return [buildOmmlAccent(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            '\u20D7', docx
          )]
        case 'tilde': case 'widetilde':
          return [buildOmmlAccent(
            (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            '\u0303', docx
          )]
        case 'text': case 'mathrm': case 'mathbf': case 'mathit': case 'mathcal': case 'mathbb': case 'mathfrak': case 'mathsf': case 'mathtt': {
          const children = (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx))
          const styleXml: Record<string, string> = {
            mathbf: '<m:rPr><m:sty m:val="b"/></m:rPr>',
            mathit: '<m:rPr><m:sty m:val="i"/></m:rPr>',
            mathcal: '<m:rPr><m:scr m:val="script"/></m:rPr>',
            mathbb: '<m:rPr><m:scr m:val="double-struck"/></m:rPr>',
            mathfrak: '<m:rPr><m:scr m:val="fraktur"/></m:rPr>',
          }
          const xml = styleXml[node.name]
          if (xml && docx.ImportedXmlComponent) {
            for (const child of children) {
              if ((child as any).rootKey === 'm:r' && Array.isArray((child as any).root)) {
                const rPr = docx.ImportedXmlComponent.fromXmlString(xml)
                ;(child as any).root.unshift(rPr)
              }
            }
          }
          return children
        }
        case ',': case ';': case ':':
          return [new MathRun(' ')]
        case '!':
          return []
        case '{': case '}':
          return [new MathRun(node.name)]
        default:
          if (GREEK_MAP[node.name]) {
            return [new MathRun(GREEK_MAP[node.name])]
          }
          if (SYMBOL_MAP[node.name]) {
            return [new MathRun(SYMBOL_MAP[node.name])]
          }
          return [new MathRun('\\' + node.name)]
      }
    }
  }
}

// ── OMML wrapper builders (docx 8.x compatible) ──
// docx 8.6.0 does NOT have MathBar / MathBracket / MathAccentCharacter classes.
// We build them via raw OMML XML + ImportedXmlComponent.fromXmlString.

function buildOmmlBar(children: any[], position: 'top' | 'bot', docx: any): any {
  const pos = position === 'top' ? 'top' : 'bot'
  // m:pos uses m:val attribute — correct
  const xml = `<m:bar><m:barPr><m:pos m:val="${pos}"/></m:barPr><m:e><m:r><m:t>_</m:t></m:r></m:e></m:bar>`
  const comp = docx.ImportedXmlComponent.fromXmlString(xml).root[0]
  const e = comp.root.find((r: any) => r.rootKey === 'm:e')
  if (e) {
    e.root.length = 0
    for (const child of children) e.root.push(child)
  }
  return comp
}

function buildOmmlBracket(children: any[], left: string, right: string, docx: any): any {
  // m:begChr and m:endChr MUST use m:val attribute (not text content)
  const xml = `<m:d><m:dPr><m:begChr m:val="${escapeXml(left)}"/><m:endChr m:val="${escapeXml(right)}"/></m:dPr><m:e><m:r><m:t>_</m:t></m:r></m:e></m:d>`
  const comp = docx.ImportedXmlComponent.fromXmlString(xml).root[0]
  const e = comp.root.find((r: any) => r.rootKey === 'm:e')
  if (e) {
    e.root.length = 0
    for (const child of children) e.root.push(child)
  }
  return comp
}

function buildOmmlAccent(children: any[], accent: string, docx: any): any {
  // m:chr MUST use m:val attribute (not text content)
  const xml = `<m:acc><m:accPr><m:chr m:val="${escapeXml(accent)}"/></m:accPr><m:e><m:r><m:t>_</m:t></m:r></m:e></m:acc>`
  const comp = docx.ImportedXmlComponent.fromXmlString(xml).root[0]
  const e = comp.root.find((r: any) => r.rootKey === 'm:e')
  if (e) {
    e.root.length = 0
    for (const child of children) e.root.push(child)
  }
  return comp
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mapText(text: string): string {
  return text
    .replace(/>=/g, '≥')
    .replace(/<=/g, '≤')
    .replace(/!=/g, '≠')
    .replace(/->/g, '→')
    .replace(/=>/g, '⇒')
    .replace(/<-/g, '←')
    .replace(/<=>/g, '⇔')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\:/g, ' ')
    .replace(/\\!/g, '')
    .replace(/\\ /g, ' ')
}

function mapDelimiter(delim: string): string {
  const map: Record<string, string> = {
    '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}',
    '|': '|', '\\|': '‖', '.': '', '/': '/',
    '\\lfloor': '⌊', '\\rfloor': '⌋',
    '\\lceil': '⌈', '\\rceil': '⌉',
    '\\langle': '⟨', '\\rangle': '⟩',
    '\\lbrace': '{', '\\rbrace': '}',
    '\\vert': '|', '\\Vert': '‖',
    '\\backslash': '\\',
  }
  return map[delim] || delim
}

// ── OMML conversion ──

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

import { convertLatexToOmml as convertLatexToOmmlV2 } from './latex-to-math-ml'

export function convertLatexToOmml(latex: string, doc: Document): Element {
  return convertLatexToOmmlV2(latex, doc, false)
}

function astNodeToOmml(node: AstNode, doc: Document): Element[] {
  switch (node.type) {
    case 'text': {
      const text = mapText(node.text)
      return [createMathRun(text, doc)]
    }
    case 'group': {
      const texts: string[] = []
      for (const child of node.children) {
        texts.push(getTextContent(child))
      }
      return [createMathRun(texts.join(''), doc)]
    }
    case 'supsub': {
      const base = astNodeToOmml(node.base, doc)
      const sup = node.sup ? node.sup.flatMap((c) => astNodeToOmml(c, doc)) : []
      const sub = node.sub ? node.sub.flatMap((c) => astNodeToOmml(c, doc)) : []

      if (node.base.type === 'cmd') {
        switch (node.base.name) {
          case 'sum': case 'prod': case 'int': case 'iint': case 'iiint': case 'oint': {
            const nary = doc.createElementNS(MATH_NS, 'm:nary')
            const naryPr = doc.createElementNS(MATH_NS, 'm:naryPr')
            const chr = doc.createElementNS(MATH_NS, 'm:chr')
            chr.setAttribute('m:val', SYMBOL_MAP[node.base.name] || '∑')
            naryPr.appendChild(chr)
            const limLoc = doc.createElementNS(MATH_NS, 'm:limLoc')
            limLoc.setAttribute('m:val', 'subSup')
            naryPr.appendChild(limLoc)
            nary.appendChild(naryPr)
            if (sub.length > 0) {
              const subEl = doc.createElementNS(MATH_NS, 'm:sub')
              for (const el of sub) subEl.appendChild(el)
              nary.appendChild(subEl)
            }
            if (sup.length > 0) {
              const supEl = doc.createElementNS(MATH_NS, 'm:sup')
              for (const el of sup) supEl.appendChild(el)
              nary.appendChild(supEl)
            }
            const e = doc.createElementNS(MATH_NS, 'm:e')
            nary.appendChild(e)
            return [nary]
          }
          case 'lim': {
            const limLow = doc.createElementNS(MATH_NS, 'm:limLow')
            const e = doc.createElementNS(MATH_NS, 'm:e')
            e.appendChild(createMathRun('lim', doc))
            limLow.appendChild(e)
            const lim = doc.createElementNS(MATH_NS, 'm:lim')
            for (const el of sub) lim.appendChild(el)
            limLow.appendChild(lim)
            return [limLow]
          }
        }
      }

      if (sup.length > 0 && sub.length > 0) {
        const sSubSup = doc.createElementNS(MATH_NS, 'm:sSubSup')
        const e = doc.createElementNS(MATH_NS, 'm:e')
        for (const el of base) e.appendChild(el)
        sSubSup.appendChild(e)
        const subEl = doc.createElementNS(MATH_NS, 'm:sub')
        for (const el of sub) subEl.appendChild(el)
        sSubSup.appendChild(subEl)
        const supEl = doc.createElementNS(MATH_NS, 'm:sup')
        for (const el of sup) supEl.appendChild(el)
        sSubSup.appendChild(supEl)
        return [sSubSup]
      } else if (sup.length > 0) {
        const sSup = doc.createElementNS(MATH_NS, 'm:sSup')
        const e = doc.createElementNS(MATH_NS, 'm:e')
        for (const el of base) e.appendChild(el)
        sSup.appendChild(e)
        const supEl = doc.createElementNS(MATH_NS, 'm:sup')
        for (const el of sup) supEl.appendChild(el)
        sSup.appendChild(supEl)
        return [sSup]
      } else if (sub.length > 0) {
        const sSub = doc.createElementNS(MATH_NS, 'm:sSub')
        const e = doc.createElementNS(MATH_NS, 'm:e')
        for (const el of base) e.appendChild(el)
        sSub.appendChild(e)
        const subEl = doc.createElementNS(MATH_NS, 'm:sub')
        for (const el of sub) subEl.appendChild(el)
        sSub.appendChild(subEl)
        return [sSub]
      }
      return base
    }
    case 'cmd': {
      switch (node.name) {
        case 'frac': {
          const f = doc.createElementNS(MATH_NS, 'm:f')
          const num = doc.createElementNS(MATH_NS, 'm:num')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) num.appendChild(n)
          f.appendChild(num)
          const den = doc.createElementNS(MATH_NS, 'm:den')
          for (const n of (node.args[1] || []).flatMap((c) => astNodeToOmml(c, doc))) den.appendChild(n)
          f.appendChild(den)
          return [f]
        }
        case 'sqrt': {
          const rad = doc.createElementNS(MATH_NS, 'm:rad')
          if (node.args.length === 2) {
            const deg = doc.createElementNS(MATH_NS, 'm:deg')
            for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) deg.appendChild(n)
            rad.appendChild(deg)
          }
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[node.args.length - 1] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          rad.appendChild(e)
          return [rad]
        }
        case 'bracket': {
          const all = node.args[0] || []
          const leftDelim = (node as any).left || '('
          const rightDelim = (node as any).right || ')'
          const d = doc.createElementNS(MATH_NS, 'm:d')
          const dPr = doc.createElementNS(MATH_NS, 'm:dPr')
          const begChr = doc.createElementNS(MATH_NS, 'm:begChr')
          begChr.setAttribute('m:val', mapDelimiter(leftDelim))
          dPr.appendChild(begChr)
          const endChr = doc.createElementNS(MATH_NS, 'm:endChr')
          endChr.setAttribute('m:val', mapDelimiter(rightDelim))
          dPr.appendChild(endChr)
          d.appendChild(dPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of all.flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          d.appendChild(e)
          return [d]
        }
        case 'overline': {
          const bar = doc.createElementNS(MATH_NS, 'm:bar')
          const barPr = doc.createElementNS(MATH_NS, 'm:barPr')
          const pos = doc.createElementNS(MATH_NS, 'm:pos')
          pos.setAttribute('m:val', 'top')
          barPr.appendChild(pos)
          bar.appendChild(barPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          bar.appendChild(e)
          return [bar]
        }
        case 'underline': {
          const bar = doc.createElementNS(MATH_NS, 'm:bar')
          const barPr = doc.createElementNS(MATH_NS, 'm:barPr')
          const pos = doc.createElementNS(MATH_NS, 'm:pos')
          pos.setAttribute('m:val', 'bot')
          barPr.appendChild(pos)
          bar.appendChild(barPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          bar.appendChild(e)
          return [bar]
        }
        case 'hat': case 'widehat': {
          const acc = doc.createElementNS(MATH_NS, 'm:acc')
          const accPr = doc.createElementNS(MATH_NS, 'm:accPr')
          const chr = doc.createElementNS(MATH_NS, 'm:chr')
          chr.setAttribute('m:val', '\u0302')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'bar': {
          const acc = doc.createElementNS(MATH_NS, 'm:acc')
          const accPr = doc.createElementNS(MATH_NS, 'm:accPr')
          const chr = doc.createElementNS(MATH_NS, 'm:chr')
          chr.setAttribute('m:val', '\u0304')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'vec': {
          const acc = doc.createElementNS(MATH_NS, 'm:acc')
          const accPr = doc.createElementNS(MATH_NS, 'm:accPr')
          const chr = doc.createElementNS(MATH_NS, 'm:chr')
          chr.setAttribute('m:val', '\u20D7')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'tilde': case 'widetilde': {
          const acc = doc.createElementNS(MATH_NS, 'm:acc')
          const accPr = doc.createElementNS(MATH_NS, 'm:accPr')
          const chr = doc.createElementNS(MATH_NS, 'm:chr')
          chr.setAttribute('m:val', '\u0303')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElementNS(MATH_NS, 'm:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'text': case 'mathrm': case 'mathbf': case 'mathit': case 'mathcal': case 'mathbb': case 'mathfrak': case 'mathsf': case 'mathtt': {
          const children = (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))
          const styleMap: Record<string, { sty?: string; scr?: string }> = {
            mathbf: { sty: 'b' },
            mathit: { sty: 'i' },
            mathcal: { scr: 'script' },
            mathbb: { scr: 'double-struck' },
            mathfrak: { scr: 'fraktur' },
          }
          const style = styleMap[node.name]
          if (style) {
            for (const child of children) {
              applyOmmlStyle(child, doc, style)
            }
          }
          return children
        }
        default:
          if (GREEK_MAP[node.name]) {
            return [createMathRun(GREEK_MAP[node.name], doc)]
          }
          if (SYMBOL_MAP[node.name]) {
            return [createMathRun(SYMBOL_MAP[node.name], doc)]
          }
          return [createMathRun('\\' + node.name, doc)]
      }
    }
  }
}

// ── Helpers ──

function createMathRun(text: string, doc: Document): Element {
  const mR = doc.createElementNS(MATH_NS, 'm:r')
  const mT = doc.createElementNS(MATH_NS, 'm:t')
  mT.textContent = text
  mR.appendChild(mT)
  return mR
}

/**
 * Recursively apply OMML math style (bold/italic/script/etc.) to all <m:r> elements.
 */
function applyOmmlStyle(el: Element, doc: Document, style: { sty?: string; scr?: string }): void {
  if (el.tagName === 'm:r') {
    let rPr = el.getElementsByTagName('m:rPr')[0] as Element | undefined
    if (!rPr) {
      rPr = doc.createElementNS(MATH_NS, 'm:rPr')
      el.insertBefore(rPr, el.firstChild)
    }
    if (style.sty) {
      const styEl = doc.createElementNS(MATH_NS, 'm:sty')
      styEl.setAttribute('m:val', style.sty)
      rPr.appendChild(styEl)
    }
    if (style.scr) {
      const scrEl = doc.createElementNS(MATH_NS, 'm:scr')
      scrEl.setAttribute('m:val', style.scr)
      rPr.appendChild(scrEl)
    }
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      applyOmmlStyle(child as Element, doc, style)
    }
  }
}

function getTextContent(node: AstNode): string {
  if (node.type === 'text') return node.text
  if (node.type === 'group') return node.children.map(getTextContent).join('')
  if (node.type === 'cmd') {
    if (node.name === 'text' || node.name === 'mathrm') {
      return (node.args[0] || []).map(getTextContent).join('')
    }
    return '\\' + node.name
  }
  return ''
}
