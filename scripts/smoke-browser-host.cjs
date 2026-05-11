/**
 * End-to-end smoke for the W3 browser-host service.
 *
 * Boots the registered host, runs a CDP-rendered search via `browserSearch`,
 * and exercises a session-scoped page (navigate → a11y → click).
 *
 * Run: electron scripts/smoke-browser-host.cjs
 */
const { app } = require('electron')
const path = require('path')

async function loadModules() {
  // The browser-host module is TS — we need the build output.
  // Build the main bundle on demand if missing.
  const fs = require('fs')
  const dist = path.join(__dirname, '..', 'dist', 'main.cjs')
  if (!fs.existsSync(dist)) {
    console.error('dist/main.cjs not found — run `bun run build:main` first.')
    process.exit(1)
  }
  // Force-load the main bundle so handlers register.
  // But that boots the full app — too much. Instead, dynamically
  // require the host file directly via esbuild on-the-fly.
  const esbuild = require('esbuild')
  const tmp = path.join(__dirname, '.tmp-host.cjs')
  const code = `
    const { registerBrowserHost, browserHost } = require('${path.join(__dirname, '..', 'src', 'main', 'browser-host.ts')}')
    const { searchWithBrowserTool } = require('${path.join(__dirname, '..', 'src', 'agent', 'tools', 'search', 'browserSearch.ts')}')
    const { renderA11yTree } = require('${path.join(__dirname, '..', 'src', 'agent', 'browser', 'compactA11y.ts')}')
    module.exports = { registerBrowserHost, browserHost, searchWithBrowserTool, renderA11yTree }
  `
  await esbuild.build({
    stdin: { contents: code, resolveDir: __dirname, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: tmp,
    external: ['electron'],
  })
  return require(tmp)
}

async function main() {
  console.log(`Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`)
  const mods = await loadModules()
  const { registerBrowserHost, browserHost, searchWithBrowserTool, renderA11yTree } = mods
  registerBrowserHost()

  // 1. Search test
  const QUERY = process.argv[2] || 'rust async runtime'
  console.log(`\n━━━ search via browser-tool ━━━`)
  console.log(`query: "${QUERY}"`)
  const t0 = Date.now()
  try {
    const outcome = await searchWithBrowserTool(QUERY, 5)
    const dt = Date.now() - t0
    console.log(`engine: ${outcome.engineUsed ?? '—'},  attempts: ${JSON.stringify(outcome.attempts)},  ${dt}ms`)
    for (const r of outcome.results) {
      console.log(`  • ${r.title}`)
      console.log(`    ${r.url}`)
      if (r.snippet) console.log(`    ${r.snippet.slice(0, 100)}`)
    }
  } catch (err) {
    console.error(`search failed: ${err.message}`)
  }

  // 2. Session a11y test — use example.com which is rock-solid + has a known link
  console.log(`\n━━━ session a11y on example.com ━━━`)
  try {
    const page = await browserHost.acquireSession('smoke')
    await page.navigate('https://example.com/', { waitUntil: 'load' })
    const t = Date.now()
    const snap = await page.getCompactA11y()
    console.log(`compact a11y: ${snap.nodes.length} nodes (${Date.now() - t}ms to fetch)`)
    const tree = renderA11yTree(snap)
    console.log(`tree size: ${tree.length} chars  ~${Math.ceil(tree.length / 4)} tokens`)
    console.log('first 600 chars:')
    console.log(tree.slice(0, 600))

    // Find any interactive link, click it
    const storyLink = snap.nodes.find((n) => n.role === 'link' && n.interactive && n.name.length > 3)
    if (storyLink && storyLink.backendNodeId !== undefined) {
      console.log(`\nclicking: ${storyLink.ref} [${storyLink.role}] "${storyLink.name.slice(0, 60)}"`)
      const before = page.getUrl()
      await page.click(storyLink.backendNodeId)
      await new Promise((r) => setTimeout(r, 2500))
      const after = page.getUrl()
      console.log(`navigated: ${before !== after ? 'YES ✓' : 'NO ✗'}  (${after})`)
    } else {
      console.log('(no suitable story link found)')
    }

    await browserHost.releaseSession('smoke')
  } catch (err) {
    console.error(`session test failed: ${err.message}`)
  }

  console.log('\nshutting down')
  await browserHost.shutdown()
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (err) {
    console.error('smoke crashed:', err)
    process.exitCode = 1
  }
  app.quit()
})
