import { ipcMain } from 'electron'
import { execSync, spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'fs'
import { join, dirname, basename, isAbsolute } from 'path'
import { tmpdir, homedir } from 'os'
import { createHash } from 'crypto'
import { taskManager } from '../agent'
import { sendToRenderer } from './file-notify'
import { savePdfCache, getCachedPdfPath } from './pdf-cache'

function findSystemCompiler(): string | null {
  const isWindows = process.platform === 'win32'
  const cmd = isWindows ? 'where' : 'which'
  for (const name of ['tectonic', 'xelatex', 'lualatex', 'pdflatex']) {
    try {
      execSync(`${cmd} ${name}`, { encoding: 'utf-8', timeout: 3000, env: process.env })
      return name
    } catch {
      continue
    }
  }
  return null
}

function getConfiguredCompiler(): string | null {
  try {
    const db = (global as any).__db
    if (!db) return null
    const raw = db.getSetting('latexSupport')
    if (!raw) return null
    const config = JSON.parse(raw)
    if (!config.enabled) return null
    if (config.compilerType === 'system-auto' || config.compilerType === 'system-manual') {
      return config.compilerPath || null
    }
    if (config.compilerType === 'bundled') {
      return config.bundledPath || null
    }
  } catch {
    // ignore
  }
  return null
}

function getEffectiveCompiler(): string | null {
  const configured = getConfiguredCompiler()
  if (configured) return configured
  return findSystemCompiler()
}

/**
 * Resolve the files a .tex depends on: \input / \include / \bibliography /
 * \addbibresource / \includegraphics. Best-effort, one level deep, trying common
 * extensions. Used to build a dependency-aware cache signature so editing a
 * child file (e.g. a .bib or \input chapter) invalidates the cached PDF.
 */
function resolveLatexDeps(texPath: string, src: string): string[] {
  const dir = dirname(texPath)
  const deps = new Set<string>()
  const add = (raw: string, exts: string[]) => {
    for (const name of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const base = isAbsolute(name) ? name : join(dir, name)
      const candidates = /\.[a-z0-9]+$/i.test(name) ? [base] : exts.map((e) => base + e)
      for (const c of candidates) { if (existsSync(c)) { deps.add(c); break } }
    }
  }
  const stripped = src.replace(/(^|[^\\])%.*$/gm, '$1')
  for (const m of stripped.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) add(m[1], ['.tex'])
  for (const m of stripped.matchAll(/\\(?:bibliography|addbibresource)\s*\{([^}]+)\}/g)) add(m[1], ['.bib'])
  for (const m of stripped.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) add(m[1], ['.pdf', '.png', '.jpg', '.jpeg', '.eps'])
  return [...deps]
}

/** Content signature = hash of the main .tex + each dependency (path + mtime + size). */
function computeLatexSignature(texPath: string): string {
  const h = createHash('sha256')
  const main = (() => { try { return readFileSync(texPath, 'utf-8') } catch { return '' } })()
  h.update(texPath).update('\0').update(main)
  for (const dep of resolveLatexDeps(texPath, main).sort()) {
    try { const st = statSync(dep); h.update('\0').update(dep).update(String(st.mtimeMs)).update(String(st.size)) } catch { /* ignore */ }
  }
  return h.digest('hex').slice(0, 16)
}

export function registerLatexHandlers() {
  ipcMain.handle('latex:compile', async (_event, filePath: string, opts?: { force?: boolean; fast?: boolean }) => {
    try {
      // Dependency-aware signature (main .tex + \input/.bib/images).
      const signature = computeLatexSignature(filePath)
      // Check cache first — unless the caller forces a fresh build (Compile button).
      if (!opts?.force) {
        const cached = getCachedPdfPath(filePath, { signature })
        if (cached.isFresh && cached.pdfPath) {
          const cachedSyncTex = cached.pdfPath.replace(/\.pdf$/i, '.synctex.gz')
          return {
            pdfPath: cached.pdfPath,
            synctexPath: existsSync(cachedSyncTex) ? cachedSyncTex : undefined,
            log: '使用缓存的 PDF（源文件及依赖未变更）',
          }
        }
      }

      const compiler = getEffectiveCompiler()
      if (!compiler) {
        return {
          error: '未找到 LaTeX 编译器（tectonic / xelatex / lualatex / pdflatex）。\n请在"设置 → 文件支持 → LaTeX"中配置编译器。',
          log: '',
        }
      }

      const dir = dirname(filePath)
      const baseName = basename(filePath, '.tex')
      const taskName = `编译 ${baseName}.tex`

      // Create a background task for tracking
      const task = taskManager.create(taskName, `使用 ${basename(compiler)} 编译`, 'latex-compile')
      taskManager.start(task.id)

      const isTectonic = basename(compiler).toLowerCase().includes('tectonic')
      // Emit SyncTeX for source-line ↔ PDF sync and double-click-to-jump.
      const latexArgs = ['-synctex=1', '-interaction=nonstopmode', '-output-directory', dir, filePath]
      const env = { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE || homedir() }

      // Inspect the source so we only run the extra passes that actually help.
      let src = ''
      try { src = readFileSync(filePath, 'utf-8') } catch { /* ignore */ }
      const stripped = src.replace(/(^|[^\\])%.*$/gm, '$1')
      const usesBiber = /\\addbibresource|backend\s*=\s*biber/.test(stripped)
      const hasBib = usesBiber
        || /\\bibliography\s*\{|\\printbibliography|\\bibliographystyle/.test(stripped)
        || /\\cite[a-zA-Z]*\s*[[{]/.test(stripped)
      const hasRefs = /\\(ref|eqref|pageref|autoref|cref|Cref|nameref|label)\b|\\tableofcontents|\\listoffigures|\\listoftables/.test(stripped)

      // bibtex/biber usually live next to the latex engine; fall back to PATH.
      const resolveSibling = (name: string) => {
        const exe = process.platform === 'win32' ? `${name}.exe` : name
        const sib = join(dirname(compiler), exe)
        return existsSync(sib) ? sib : name
      }
      const runCmd = (cmd: string, args: string[]) =>
        new Promise<{ code: number | null; output: string }>((res) => {
          let out = ''
          const p = spawn(cmd, args, { cwd: dir, env })
          p.stdout.on('data', (d: Buffer) => { const t = d.toString(); out += t; taskManager.appendOutput(task.id, t) })
          p.stderr.on('data', (d: Buffer) => { const t = d.toString(); out += t; taskManager.appendOutput(task.id, t) })
          p.on('close', (code) => res({ code, output: out }))
          p.on('error', (err) => res({ code: -1, output: `\n[${basename(cmd)}] 启动失败: ${err.message}\n` }))
        })

      return (async (): Promise<{ pdfPath?: string; synctexPath?: string; error?: string; log?: string; deps?: string[] }> => {
        let simProgress = 0
        // Simulate progress since the compilers don't emit a percentage.
        const progressTimer = setInterval(() => {
          simProgress = Math.min(90, simProgress + Math.random() * 8)
          taskManager.updateProgress(task.id, Math.floor(simProgress))
          sendToRenderer('task:progress', task.id, Math.floor(simProgress))
        }, 1500)

        let output = ''
        let lastCode: number | null = 0
        try {
          if (isTectonic) {
            // tectonic resolves cross-references + bibliography (biber) on its own.
            const r = await runCmd(compiler, ['--synctex', '--outdir', dir, filePath])
            output += r.output; lastCode = r.code
          } else if (opts?.fast) {
            // Fast preview (auto-on-save for small text edits): a SINGLE pass that
            // reuses the existing .aux/.bbl. Cross-refs/citations resolve from the
            // previous full build — the Compile button does the full multi-pass.
            const r = await runCmd(compiler, latexArgs); output += r.output; lastCode = r.code
          } else {
            // Pass 1
            let r = await runCmd(compiler, latexArgs); output += r.output; lastCode = r.code
            if (hasBib) {
              // pdflatex → bibtex/biber → pdflatex → pdflatex
              const rb = await runCmd(resolveSibling(usesBiber ? 'biber' : 'bibtex'), [baseName])
              output += rb.output
              r = await runCmd(compiler, latexArgs); output += r.output; lastCode = r.code
              r = await runCmd(compiler, latexArgs); output += r.output; lastCode = r.code
            } else if (hasRefs) {
              // One extra pass to settle \ref / table of contents.
              r = await runCmd(compiler, latexArgs); output += r.output; lastCode = r.code
            }
          }
        } catch (err: any) {
          output += `\n编译异常: ${err?.message || err}\n`
        }
        clearInterval(progressTimer)

        const tempPdfPath = join(dir, baseName + '.pdf')
        // Success is based on a produced PDF (nonstopmode can exit non-zero on
        // warnings yet still emit a usable preview).
        if (existsSync(tempPdfPath)) {
          try {
            const pdfBuffer = readFileSync(tempPdfPath)
            const cachedPath = savePdfCache(filePath, pdfBuffer, { signature })
            unlinkSync(tempPdfPath)
            // Persist the SyncTeX map next to the cached PDF.
            let synctexPath: string | undefined
            try {
              const tempSyncTex = join(dir, baseName + '.synctex.gz')
              if (existsSync(tempSyncTex)) {
                const cachedSyncTex = cachedPath.replace(/\.pdf$/i, '.synctex.gz')
                writeFileSync(cachedSyncTex, readFileSync(tempSyncTex))
                unlinkSync(tempSyncTex)
                synctexPath = cachedSyncTex
              }
            } catch { /* best-effort */ }
            taskManager.complete(task.id, '编译成功')
            sendToRenderer('task:completed', task.id)
            return { pdfPath: cachedPath, synctexPath, log: output, deps: resolveLatexDeps(filePath, readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n')) }
          } catch (err: any) {
            const errMsg = `缓存保存失败: ${err.message}`
            taskManager.fail(task.id, errMsg)
            sendToRenderer('task:failed', task.id, errMsg)
            return { error: errMsg, log: output }
          }
        } else {
          const errMsg = `编译失败 (exit ${lastCode})`
          taskManager.fail(task.id, errMsg)
          sendToRenderer('task:failed', task.id, errMsg)
          return { error: errMsg, log: output }
        }
      })()
    } catch (err: any) {
      return { error: err.message || '编译失败', log: '' }
    }
  })
}

