/**
 * End-to-end smoke for webFetch's auto-escalation.
 *
 * Run: electron scripts/smoke-fetch.cjs [url]
 */
const { app } = require('electron')
const path = require('path')

async function loadModules() {
  const esbuild = require('esbuild')
  const tmp = path.join(__dirname, '.tmp-fetch.cjs')
  const code = `
    const { registerBrowserHost, browserHost } = require('${path.join(__dirname, '..', 'src', 'main', 'browser-host.ts')}')
    const { WebFetchTool } = require('${path.join(__dirname, '..', 'src', 'agent', 'tools', 'impl', 'webFetch.ts')}')
    module.exports = { registerBrowserHost, browserHost, WebFetchTool }
  `
  await esbuild.build({
    stdin: { contents: code, resolveDir: __dirname, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs',
    outfile: tmp, external: ['electron'],
  })
  return require(tmp)
}

async function fetchOne(url, WebFetchTool) {
  console.log(`\n━━━ ${url} ━━━`)
  const t0 = Date.now()
  try {
    const r = await WebFetchTool.call({ url, maxChars: 4000 }, {
      workspacePath: process.cwd(),
      mode: 'execute',
    })
    const dt = Date.now() - t0
    if (r.error) {
      console.log(`  error: ${r.error}  (${dt}ms)`)
    } else {
      console.log(`  ${r.preview}  (${dt}ms)`)
      console.log(`  preview text:\n  ${(r.data || '').slice(0, 240).replace(/\n/g, '\n  ')}`)
    }
  } catch (err) {
    console.error(`  exception: ${err.message}`)
  }
}

async function main() {
  console.log(`Electron ${process.versions.electron}`)
  const { registerBrowserHost, browserHost, WebFetchTool } = await loadModules()
  registerBrowserHost()

  const customUrl = process.argv[2]

  if (customUrl) {
    await fetchOne(customUrl, WebFetchTool)
  } else {
    // Static doc — should hit Tier 1.
    await fetchOne('https://example.com/', WebFetchTool)
    // Long-form static page — Tier 1 with markdown headings.
    await fetchOne('https://en.wikipedia.org/wiki/Lexical_token', WebFetchTool)
    // SPA — should escalate to Tier 2.
    await fetchOne('https://react.dev/', WebFetchTool)
    // 404 — should escalate to Tier 2 (which will also probably fail).
    await fetchOne('https://example.com/this-page-does-not-exist', WebFetchTool)
    // JSON API — should pass through Tier 1 unchanged.
    await fetchOne('https://api.github.com/repos/anthropics/claude-code', WebFetchTool)
  }

  console.log('\nshutting down')
  await browserHost.shutdown()
}

app.whenReady().then(async () => {
  try { await main() } catch (e) { console.error('crash:', e); process.exitCode = 1 }
  app.quit()
})
