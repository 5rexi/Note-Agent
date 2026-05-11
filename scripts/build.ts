#!/usr/bin/env bun
import { build } from 'esbuild'
import { createServer } from 'vite'
import { spawn } from 'child_process'
import { resolve } from 'path'

const isDev = process.argv.includes('--dev')

async function buildMain() {
  await build({
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/main.cjs',
    external: ['electron', 'better-sqlite3'],
    sourcemap: true,
  })
  console.log('✅ Main process built')
}

async function buildPreload() {
  await build({
    entryPoints: ['src/preload/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/preload.cjs',
    external: ['electron'],
    sourcemap: true,
  })
  console.log('✅ Preload built')
}

async function dev() {
  await buildMain()
  await buildPreload()

  const viteServer = await createServer({
    configFile: resolve('vite.config.ts'),
    root: resolve('src/renderer'),
    base: './',
  })
  await viteServer.listen(5173)
  console.log('⚡ Vite dev server running on http://localhost:5173')

  const electron = spawn('electron', ['dist/main.cjs'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  })

  process.on('SIGINT', () => {
    electron.kill()
    viteServer.close()
    process.exit(0)
  })
}

async function prod() {
  await buildMain()
  await buildPreload()

  const { build: viteBuild } = await import('vite')
  await viteBuild({
    configFile: resolve('vite.config.ts'),
  })
  console.log('✅ Renderer built')
}

if (isDev) {
  dev()
} else {
  prod()
}
