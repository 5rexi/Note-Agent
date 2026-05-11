/**
 * Spike: Electron WebContents + CDP as a Puppeteer replacement.
 *
 * Goals validated by this script:
 *   1. A hidden BrowserWindow can load arbitrary URLs in the main process.
 *   2. webContents.debugger gives us full CDP — no Puppeteer.
 *   3. Accessibility.getFullAXTree yields a *much* smaller representation than DOM.
 *   4. We can resolve an a11y node back to a DOM RemoteObject and click it via CDP.
 *
 * Run: electron scripts/spike-browser.cjs
 */
const { app, BrowserWindow } = require('electron')

const TARGETS = [
  'https://example.com',
  'https://news.ycombinator.com',
  'https://en.wikipedia.org/wiki/Lexical_token',
]

const tokenEstimate = (s) => Math.ceil(s.length / 4)

function pad(n, width) {
  return String(n).padStart(width)
}

async function attachCdp(wc) {
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3')
  }
  return (method, params) => wc.debugger.sendCommand(method, params || {})
}

/**
 * Walk the flat AX tree and emit a compact representation.
 *
 * Aggressive filtering rules (each one cuts a major source of bloat):
 *   - drop InlineTextBox (paint-level line breaks, never useful to LLM)
 *   - drop ignored nodes
 *   - drop generic/none/presentation/LayoutTable* roles unless they bring a name
 *   - drop StaticText when its name equals the parent's name (avoids duplication
 *     since most renderers expose `[link] X / StaticText X` for the same text)
 *   - collapse nameless wrappers — emit only their children
 *   - cap depth to keep tree shape readable
 */
const STRUCTURAL_DROP_ROLES = new Set([
  'InlineTextBox',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
])
const TRANSPARENT_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'group',
  'paragraph', // we keep the text; the role wrapper is noise
])

function flattenA11yCompact(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const childrenOf = new Map()
  for (const n of nodes) {
    if (!n.parentId) continue
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, [])
    childrenOf.get(n.parentId).push(n.nodeId)
  }
  const root = nodes.find((n) => !n.parentId) || nodes[0]
  const lines = []

  function nameOf(n) {
    const v = n.name && n.name.value
    return v ? String(v).replace(/\s+/g, ' ').trim() : ''
  }

  function walk(id, depth, parentName) {
    const n = byId.get(id)
    if (!n) return
    const role = n.role && n.role.value
    const ignored = n.ignored
    const name = nameOf(n)
    const kids = childrenOf.get(id) || []

    if (!ignored && role) {
      if (STRUCTURAL_DROP_ROLES.has(role)) {
        // skip self, recurse into children at same depth
        for (const k of kids) walk(k, depth, parentName)
        return
      }
      if (role === 'StaticText') {
        if (name && name !== parentName) {
          const indent = '  '.repeat(Math.min(depth, 8))
          lines.push(`${indent}${name.slice(0, 200)}`)
        }
        // children of StaticText are InlineTextBox — drop
        return
      }
      if (TRANSPARENT_ROLES.has(role) && !name) {
        for (const k of kids) walk(k, depth, parentName)
        return
      }
      const indent = '  '.repeat(Math.min(depth, 8))
      if (name) {
        lines.push(`${indent}[${role}] ${name.slice(0, 200)}`)
      } else {
        lines.push(`${indent}[${role}]`)
      }
      for (const k of kids) walk(k, depth + 1, name)
      return
    }
    for (const k of kids) walk(k, depth, parentName)
  }

  walk(root.nodeId, 0, '')
  return lines.join('\n')
}

/**
 * Bare innerText baseline — the dumb floor we have to beat.
 */
function rawA11y(nodes) {
  // Same as the v1 — for stats comparison
  const lines = []
  for (const n of nodes) {
    const role = n.role && n.role.value
    const name = n.name && n.name.value
    if (!role) continue
    if (n.ignored) continue
    if (name) lines.push(`[${role}] ${String(name).replace(/\s+/g, ' ').trim()}`)
    else lines.push(`[${role}]`)
  }
  return lines.join('\n')
}

async function snapshotAndCompare(wc, url) {
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`URL: ${url}`)
  console.log('═'.repeat(72))

  const tNavStart = Date.now()
  await wc.loadURL(url)
  const tNav = Date.now() - tNavStart

  const send = await attachCdp(wc)

  const tHtmlStart = Date.now()
  const html = await wc.executeJavaScript('document.documentElement.outerHTML')
  const tHtml = Date.now() - tHtmlStart

  const tInnerStart = Date.now()
  const innerText = await wc.executeJavaScript('document.body && document.body.innerText || ""')
  const tInner = Date.now() - tInnerStart

  const tA11yStart = Date.now()
  await send('Accessibility.enable')
  const { nodes } = await send('Accessibility.getFullAXTree')
  const a11yRaw = rawA11y(nodes)
  const a11yCompact = flattenA11yCompact(nodes)
  const tA11y = Date.now() - tA11yStart

  const rows = [
    ['source', 'bytes', '~tokens', 'time(ms)'],
    ['outerHTML', html.length, tokenEstimate(html), tHtml],
    ['innerText', innerText.length, tokenEstimate(innerText), tInner],
    ['a11y raw', a11yRaw.length, tokenEstimate(a11yRaw), tA11y],
    ['a11y compact', a11yCompact.length, tokenEstimate(a11yCompact), tA11y],
  ]
  console.log(`navigation: ${tNav}ms,  AX nodes raw: ${nodes.length}`)
  for (const r of rows) {
    console.log(`  ${pad(r[0], 12)}  ${pad(r[1], 8)}  ${pad(r[2], 8)}  ${pad(r[3], 8)}`)
  }
  const reduction = ((1 - a11yCompact.length / html.length) * 100).toFixed(1)
  console.log(`  compact a11y vs HTML: ${reduction}% smaller`)

  console.log('\n--- a11y compact preview (first 600 chars) ---')
  console.log(a11yCompact.slice(0, 600))
  console.log('--- end preview ---')

  return { nodes }
}

/**
 * Validate that we can click an element selected from the a11y tree, going
 * AX node -> backendNodeId -> RemoteObject -> .click() over CDP. This is
 * the production-flavored "click by a11y reference" path.
 */
async function clickSpike(wc, nodes) {
  console.log(`\n${'═'.repeat(72)}`)
  console.log('CDP click spike: click "Learn more" / "More information" link on example.com')
  console.log('═'.repeat(72))

  const target = nodes.find(
    (n) =>
      n.role && n.role.value === 'link' &&
      n.name && /(learn more|more information)/i.test(n.name.value || ''),
  )
  if (!target) {
    console.log('  (link not found — page layout changed; skipping click validation)')
    return
  }
  if (!target.backendDOMNodeId) {
    console.log('  (target has no backendDOMNodeId — skipping)')
    return
  }

  const send = await attachCdp(wc)
  const before = wc.getURL()
  console.log(`  target: [${target.role.value}] "${target.name.value}"  backendNodeId=${target.backendDOMNodeId}`)

  // Get box model so we can dispatch a real mouse event at the element's center.
  // This is the gold-standard CDP click — works even when untrusted JS clicks fail.
  let box
  try {
    box = await send('DOM.getBoxModel', { backendNodeId: target.backendDOMNodeId })
  } catch (err) {
    console.log(`  DOM.getBoxModel failed: ${err.message}`)
    return
  }
  // box.model.content = [x1,y1, x2,y2, x3,y3, x4,y4]
  const c = box.model.content
  const cx = (c[0] + c[2] + c[4] + c[6]) / 4
  const cy = (c[1] + c[3] + c[5] + c[7]) / 4
  console.log(`  dispatching mouse press+release at (${cx.toFixed(0)}, ${cy.toFixed(0)})`)

  // Scroll into view first (otherwise the click coords may be offscreen)
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: target.backendDOMNodeId })

  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: cx, y: cy,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1,
  })

  // Wait for navigation to settle
  await new Promise((r) => setTimeout(r, 3000))
  const after = wc.getURL()
  console.log(`  before: ${before}`)
  console.log(`  after:  ${after}`)
  console.log(`  navigated: ${before !== after ? 'YES ✓' : 'NO ✗'}`)
}

async function spike() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // sandbox interferes with debugger.attach in some configs
    },
  })

  let firstNodes = null
  for (let i = 0; i < TARGETS.length; i++) {
    const url = TARGETS[i]
    try {
      const { nodes } = await snapshotAndCompare(win.webContents, url)
      if (i === 0) firstNodes = nodes
    } catch (err) {
      console.error(`  (failed: ${err.message})`)
    }
  }

  // CDP click validation against example.com
  try {
    await win.webContents.loadURL('https://example.com')
    const send = await attachCdp(win.webContents)
    await send('Accessibility.enable')
    const { nodes } = await send('Accessibility.getFullAXTree')
    await clickSpike(win.webContents, nodes)
  } catch (err) {
    console.error(`  (click spike failed: ${err.message})`)
  }

  console.log('\nspike complete — destroying window')
  win.destroy()
}

app.whenReady().then(async () => {
  console.log(`Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`)
  try {
    await spike()
  } catch (err) {
    console.error('Spike crashed:', err)
    process.exitCode = 1
  }
  app.quit()
})
