import { ipcMain } from 'electron'
import { execSync, spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join, dirname, basename } from 'path'
import { tmpdir, homedir } from 'os'
import { taskManager } from '../agent'
import { sendToRenderer } from './file-notify'
import { savePdfCache, getCachedPdfPath } from './pdf-cache'
import { convertWithSoffice } from './word-office'

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

export function registerLatexHandlers() {
  ipcMain.handle('latex:compile', async (_event, filePath: string) => {
    try {
      // Check cache first
      const cached = getCachedPdfPath(filePath)
      if (cached.isFresh && cached.pdfPath) {
        return { pdfPath: cached.pdfPath, log: '使用缓存的 PDF（源文件未变更）' }
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

      return new Promise<{ pdfPath?: string; error?: string; log?: string }>((resolve) => {
        const isTectonic = basename(compiler).toLowerCase().includes('tectonic')
        const args = isTectonic
          ? ['--outdir', dir, filePath]
          : ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', dir, filePath]
        const proc = spawn(compiler, args, {
          cwd: dir,
          env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE || homedir() },
        })

        let output = ''
        let simProgress = 0
        // Simulate progress since tectonic doesn't emit percentage
        const progressTimer = setInterval(() => {
          simProgress = Math.min(90, simProgress + Math.random() * 8)
          taskManager.updateProgress(task.id, Math.floor(simProgress))
          sendToRenderer('task:progress', task.id, Math.floor(simProgress))
        }, 1500)

        proc.stdout.on('data', (data: Buffer) => {
          const text = data.toString()
          output += text
          taskManager.appendOutput(task.id, text)
        })

        proc.stderr.on('data', (data: Buffer) => {
          const text = data.toString()
          output += text
          taskManager.appendOutput(task.id, text)
        })

        proc.on('close', (code) => {
          clearInterval(progressTimer)
          const tempPdfPath = join(dir, baseName + '.pdf')
          if (code === 0 && existsSync(tempPdfPath)) {
            try {
              // Copy to cache and clean up temp PDF
              const pdfBuffer = readFileSync(tempPdfPath)
              const cachedPath = savePdfCache(filePath, pdfBuffer)
              unlinkSync(tempPdfPath)
              taskManager.complete(task.id, '编译成功')
              sendToRenderer('task:completed', task.id)
              resolve({ pdfPath: cachedPath, log: output })
            } catch (err: any) {
              const errMsg = `缓存保存失败: ${err.message}`
              taskManager.fail(task.id, errMsg)
              sendToRenderer('task:failed', task.id, errMsg)
              resolve({ error: errMsg, log: output })
            }
          } else {
            const errMsg = `编译失败 (exit ${code})`
            taskManager.fail(task.id, errMsg)
            sendToRenderer('task:failed', task.id, errMsg)
            resolve({ error: errMsg, log: output })
          }
        })

        proc.on('error', (err) => {
          clearInterval(progressTimer)
          const errMsg = err.message || '编译进程启动失败'
          taskManager.fail(task.id, errMsg)
          sendToRenderer('task:failed', task.id, errMsg)
          resolve({ error: errMsg, log: output })
        })
      })
    } catch (err: any) {
      return { error: err.message || '编译失败', log: '' }
    }
  })
}

// Office-to-PDF conversion (PPTX via LibreOffice, same as Word)
async function convertPptxToPdf(filePath: string): Promise<{ pdfPath?: string; error?: string }> {
  return convertWithSoffice(filePath, 'pdf')
}

export function registerOfficeHandlers() {
  ipcMain.handle('office:convertToPdf', async (_event, filePath: string) => {
    try {
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (ext === 'pptx') {
        return convertPptxToPdf(filePath)
      }
      return { error: `不支持的 Office 格式: .${ext}` }
    } catch (err: any) {
      return { error: err.message || '转换失败' }
    }
  })
}
