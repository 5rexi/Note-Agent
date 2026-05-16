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
  cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin', arccos: 'arccos',
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
          if (delim.type === 'TEXT' || delim.type === 'LBRACE' || delim.type === 'RBRACE' || delim.type === 'LBRACKET' || delim.type === 'RBRACKET') {
            leftDelim = delim.value
            consume()
          }
          const inner: AstNode[] = []
          while (peek().type !== 'EOF') {
            if (peek().type === 'CMD' && peek().value === 'right') {
              consume()
              const rightDelimToken = peek()
              let rightDelim = ')'
              if (rightDelimToken.type === 'TEXT' || rightDelimToken.type === 'LBRACE' || rightDelimToken.type === 'RBRACE' || rightDelimToken.type === 'LBRACKET' || rightDelimToken.type === 'RBRACKET') {
                rightDelim = rightDelimToken.value
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
          args.push(parseGroupOrAtom(stopAtRight))
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


// ── docx conversion ──

export function convertLatexToDocxMath(latex: string, docx: any): any {
  try {
    const { Math } = docx
    const nodes = parseLatex(latex)
    const children = nodes.flatMap((n) => astNodeToDocx(n, docx))
    return new Math({ children })
  } catch (e) {
    const { Math, MathRun } = docx
    return new Math({ children: [new MathRun(latex)] })
  }
}

function astNodeToDocx(node: AstNode, docx: any): any[] {
  const {
    MathRun, MathFraction, MathSuperScript, MathSubScript, MathSubSuperScript,
    MathRadical, MathSum, MathIntegral, MathLimitLower, MathAccentCharacter,
    MathBar, MathBracket,
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
          if (all.length >= 2) {
            const first = all[0]
            const last = all[all.length - 1]
            const leftDelim = first.type === 'text' ? first.text : '('
            const rightDelim = last.type === 'text' ? last.text : ')'
            const content = all.slice(1, -1)
            return [new MathBracket({
              children: content.flatMap((c) => astNodeToDocx(c, docx)),
              beginningCharacter: mapDelimiter(leftDelim),
              endingCharacter: mapDelimiter(rightDelim),
            })]
          }
          return [new MathBracket({
            children: all.flatMap((c) => astNodeToDocx(c, docx)),
            beginningCharacter: '(',
            endingCharacter: ')',
          })]
        }
        case 'overline':
          return [new MathBar({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            position: 'top',
          })]
        case 'underline':
          return [new MathBar({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            position: 'bottom',
          })]
        case 'hat': case 'widehat':
          return [new MathAccentCharacter({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            character: '\u0302',
          })]
        case 'bar':
          return [new MathAccentCharacter({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            character: '\u0304',
          })]
        case 'vec':
          return [new MathAccentCharacter({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            character: '\u20D7',
          })]
        case 'tilde': case 'widetilde':
          return [new MathAccentCharacter({
            children: (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx)),
            character: '\u0303',
          })]
        case 'text': case 'mathrm':
          return (node.args[0] || []).flatMap((c) => astNodeToDocx(c, docx))
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
  }
  return map[delim] || delim
}

// ── OMML conversion ──

export function convertLatexToOmml(latex: string, doc: Document): Element {
  try {
    const oMath = doc.createElement('m:oMath')
    const nodes = parseLatex(latex)
    for (const node of nodes) {
      for (const el of astNodeToOmml(node, doc)) {
        oMath.appendChild(el)
      }
    }
    return oMath
  } catch (e) {
    const oMath = doc.createElement('m:oMath')
    const mR = doc.createElement('m:r')
    const mT = doc.createElement('m:t')
    mT.textContent = latex
    mR.appendChild(mT)
    oMath.appendChild(mR)
    return oMath
  }
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
            const nary = doc.createElement('m:nary')
            const naryPr = doc.createElement('m:naryPr')
            const chr = doc.createElement('m:chr')
            chr.setAttribute('m:val', SYMBOL_MAP[node.base.name] || '∑')
            naryPr.appendChild(chr)
            const limLoc = doc.createElement('m:limLoc')
            limLoc.setAttribute('m:val', 'subSup')
            naryPr.appendChild(limLoc)
            nary.appendChild(naryPr)
            if (sub.length > 0) {
              const subEl = doc.createElement('m:sub')
              for (const el of sub) subEl.appendChild(el)
              nary.appendChild(subEl)
            }
            if (sup.length > 0) {
              const supEl = doc.createElement('m:sup')
              for (const el of sup) supEl.appendChild(el)
              nary.appendChild(supEl)
            }
            const e = doc.createElement('m:e')
            nary.appendChild(e)
            return [nary]
          }
          case 'lim': {
            const limLow = doc.createElement('m:limLow')
            const e = doc.createElement('m:e')
            e.appendChild(createMathRun('lim', doc))
            limLow.appendChild(e)
            const lim = doc.createElement('m:lim')
            for (const el of sub) lim.appendChild(el)
            limLow.appendChild(lim)
            return [limLow]
          }
        }
      }

      if (sup.length > 0 && sub.length > 0) {
        const sSubSup = doc.createElement('m:sSubSup')
        const e = doc.createElement('m:e')
        for (const el of base) e.appendChild(el)
        sSubSup.appendChild(e)
        const subEl = doc.createElement('m:sub')
        for (const el of sub) subEl.appendChild(el)
        sSubSup.appendChild(subEl)
        const supEl = doc.createElement('m:sup')
        for (const el of sup) supEl.appendChild(el)
        sSubSup.appendChild(supEl)
        return [sSubSup]
      } else if (sup.length > 0) {
        const sSup = doc.createElement('m:sSup')
        const e = doc.createElement('m:e')
        for (const el of base) e.appendChild(el)
        sSup.appendChild(e)
        const supEl = doc.createElement('m:sup')
        for (const el of sup) supEl.appendChild(el)
        sSup.appendChild(supEl)
        return [sSup]
      } else if (sub.length > 0) {
        const sSub = doc.createElement('m:sSub')
        const e = doc.createElement('m:e')
        for (const el of base) e.appendChild(el)
        sSub.appendChild(e)
        const subEl = doc.createElement('m:sub')
        for (const el of sub) subEl.appendChild(el)
        sSub.appendChild(subEl)
        return [sSub]
      }
      return base
    }
    case 'cmd': {
      switch (node.name) {
        case 'frac': {
          const f = doc.createElement('m:f')
          const num = doc.createElement('m:num')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) num.appendChild(n)
          f.appendChild(num)
          const den = doc.createElement('m:den')
          for (const n of (node.args[1] || []).flatMap((c) => astNodeToOmml(c, doc))) den.appendChild(n)
          f.appendChild(den)
          return [f]
        }
        case 'sqrt': {
          const rad = doc.createElement('m:rad')
          if (node.args.length === 2) {
            const deg = doc.createElement('m:deg')
            for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) deg.appendChild(n)
            rad.appendChild(deg)
          }
          const e = doc.createElement('m:e')
          for (const n of (node.args[node.args.length - 1] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          rad.appendChild(e)
          return [rad]
        }
        case 'bracket': {
          const all = node.args[0] || []
          if (all.length >= 2) {
            const first = all[0]
            const last = all[all.length - 1]
            const leftDelim = first.type === 'text' ? first.text : '('
            const rightDelim = last.type === 'text' ? last.text : ')'
            const content = all.slice(1, -1)
            const d = doc.createElement('m:d')
            const dPr = doc.createElement('m:dPr')
            const begChr = doc.createElement('m:begChr')
            begChr.setAttribute('m:val', mapDelimiter(leftDelim))
            dPr.appendChild(begChr)
            const endChr = doc.createElement('m:endChr')
            endChr.setAttribute('m:val', mapDelimiter(rightDelim))
            dPr.appendChild(endChr)
            d.appendChild(dPr)
            const e = doc.createElement('m:e')
            for (const n of content.flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
            d.appendChild(e)
            return [d]
          }
          return [createMathRun('(', doc)]
        }
        case 'overline': {
          const bar = doc.createElement('m:bar')
          const barPr = doc.createElement('m:barPr')
          const pos = doc.createElement('m:pos')
          pos.setAttribute('m:val', 'top')
          barPr.appendChild(pos)
          bar.appendChild(barPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          bar.appendChild(e)
          return [bar]
        }
        case 'underline': {
          const bar = doc.createElement('m:bar')
          const barPr = doc.createElement('m:barPr')
          const pos = doc.createElement('m:pos')
          pos.setAttribute('m:val', 'bot')
          barPr.appendChild(pos)
          bar.appendChild(barPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          bar.appendChild(e)
          return [bar]
        }
        case 'hat': case 'widehat': {
          const acc = doc.createElement('m:acc')
          const accPr = doc.createElement('m:accPr')
          const chr = doc.createElement('m:chr')
          chr.setAttribute('m:val', '\u0302')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'bar': {
          const acc = doc.createElement('m:acc')
          const accPr = doc.createElement('m:accPr')
          const chr = doc.createElement('m:chr')
          chr.setAttribute('m:val', '\u0304')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'vec': {
          const acc = doc.createElement('m:acc')
          const accPr = doc.createElement('m:accPr')
          const chr = doc.createElement('m:chr')
          chr.setAttribute('m:val', '\u20D7')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'tilde': case 'widetilde': {
          const acc = doc.createElement('m:acc')
          const accPr = doc.createElement('m:accPr')
          const chr = doc.createElement('m:chr')
          chr.setAttribute('m:val', '\u0303')
          accPr.appendChild(chr)
          acc.appendChild(accPr)
          const e = doc.createElement('m:e')
          for (const n of (node.args[0] || []).flatMap((c) => astNodeToOmml(c, doc))) e.appendChild(n)
          acc.appendChild(e)
          return [acc]
        }
        case 'text': case 'mathrm': {
          const texts: string[] = []
          for (const n of (node.args[0] || [])) texts.push(getTextContent(n))
          return [createMathRun(texts.join(''), doc)]
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
  const mR = doc.createElement('m:r')
  const mT = doc.createElement('m:t')
  mT.textContent = text
  mR.appendChild(mT)
  return mR
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
