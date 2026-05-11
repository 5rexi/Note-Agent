/**
 * End-to-end smoke for the BrowseTool.
 *
 * Drives a multi-step interaction: navigate → observe → click → extract.
 * Run: electron scripts/smoke-browse.cjs
 */
const { app } = require('electron')
const path = require('path')

async function loadModules() {
  const esbuild = require('esbuild')
  const tmp = path.join(__dirname, '.tmp-browse.cjs')
  const code = `
    const { registerBrowserHost, browserHost } = require('${path.join(__dirname, '..', 'src', 'main', 'browser-host.ts')}')
    const { BrowseTool } = require('${path.join(__dirname, '..', 'src', 'agent', 'tools', 'impl', 'browse.ts')}')
    module.exports = { registerBrowserHost, browserHost, BrowseTool }
  `
  await esbuild.build({
    stdin: { contents: code, resolveDir: __dirname, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs',
    outfile: tmp, external: ['electron'],
  })
  return require(tmp)
}

const SESSION_ID = 'smoke-browse'

async function run(BrowseTool, label, input) {
  console.log(`\n  → ${label}`)
  console.log(`    input: ${JSON.stringify(input)}`)
  const t0 = Date.now()
  try {
    const r = await BrowseTool.call(input, {
      workspacePath: process.cwd(),
      mode: 'execute',
      sessionId: SESSION_ID,
    })
    const dt = Date.now() - t0
    if (r.error) {
      console.log(`    error: ${r.error}  (${dt}ms)`)
      return null
    }
    console.log(`    ${r.preview}  (${dt}ms)`)
    if (r.data && typeof r.data === 'object' && 'result' in r.data) {
      const result = r.data.result
      if (result && typeof result === 'object' && 'view' in result) {
        // observe output — show first 8 lines
        const lines = String(result.view).split('\n').slice(0, 8)
        console.log('    view (first 8 lines):')
        for (const l of lines) console.log(`      ${l}`)
      } else if (result && typeof result === 'object' && 'text' in result) {
        const text = String(result.text).slice(0, 200)
        console.log(`    extracted preview: ${text}`)
      }
    }
    return r
  } catch (err) {
    console.log(`    exception: ${err.message}`)
    return null
  }
}

async function main() {
  console.log(`Electron ${process.versions.electron}`)
  const { registerBrowserHost, browserHost, BrowseTool } = await loadModules()
  registerBrowserHost()

  console.log('\n━━━ Flow 1: navigate → observe → click → extract ━━━')
  await run(BrowseTool, 'navigate to example.com', { action: 'navigate', url: 'https://example.com/' })
  const obs = await run(BrowseTool, 'observe', { action: 'observe' })

  // Pull a ref from the observe result and click it
  const refMatch = (obs?.data?.result?.view || '').match(/(ax:\d+)\s+\[link\]\s+Learn more/i)
  if (refMatch) {
    await run(BrowseTool, `click ref ${refMatch[1]}`, { action: 'click', ref: refMatch[1] })
    await run(BrowseTool, 'extract markdown', { action: 'extract', mode: 'markdown', maxChars: 800 })
  } else {
    // text-fallback path
    await run(BrowseTool, 'click by text "Learn more"', { action: 'click', text: 'Learn more' })
    await run(BrowseTool, 'extract markdown', { action: 'extract', mode: 'markdown', maxChars: 800 })
  }

  console.log('\n━━━ Flow 2: text-fallback click ━━━')
  await run(BrowseTool, 'navigate back to example.com', { action: 'navigate', url: 'https://example.com/' })
  await run(BrowseTool, 'click by visible text', { action: 'click', text: 'Learn' })

  console.log('\n━━━ Flow 3: explore mode rejects mutations ━━━')
  // Manually call with explore mode
  const r = await BrowseTool.call({ action: 'click', ref: 'ax:0' }, {
    workspacePath: process.cwd(),
    mode: 'explore',
    sessionId: SESSION_ID,
  }).catch((e) => ({ error: e.message }))
  // We expect permission gating to happen *outside* call() — but if the perm check is invoked...
  // For this smoke, just verify checkPermissions returns 'deny' for explore + click.
  const perm = BrowseTool.checkPermissions({ action: 'click', ref: 'ax:0' }, {
    workspacePath: process.cwd(),
    mode: 'explore',
    sessionId: SESSION_ID,
  })
  console.log(`  explore mode click permission: ${JSON.stringify(perm)}`)

  console.log('\n━━━ close session ━━━')
  await run(BrowseTool, 'close', { action: 'close' })

  console.log('\nshutting down')
  await browserHost.shutdown()
}

app.whenReady().then(async () => {
  try { await main() } catch (e) { console.error('crash:', e); process.exitCode = 1 }
  app.quit()
})
