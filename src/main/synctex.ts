/**
 * Minimal SyncTeX (.synctex.gz) parser + IPC — maps source (file, line) ↔ PDF
 * (page, x, y). Parsed in-process (no external `synctex` CLI) so it works with
 * tectonic too. Coordinates are converted from SyncTeX "small points" to PDF pt.
 */
import { ipcMain } from 'electron'
import { readFileSync, existsSync, statSync } from 'fs'
import { gunzipSync } from 'zlib'

const SP_PER_PT = 65536
const PT_PER_INCH = 72.27
const PDF_PT_PER_INCH = 72
const sp2pdf = (sp: number) => (sp / SP_PER_PT) / PT_PER_INCH * PDF_PT_PER_INCH

interface Box { page: number; x: number; y: number; line: number; tag: number }
interface Parsed { files: Map<number, string>; boxes: Box[] }

const cache = new Map<string, { mtime: number; data: Parsed }>()

function parse(p: string): Parsed | null {
  if (!existsSync(p)) return null
  let text: string
  try {
    const raw = readFileSync(p)
    text = p.endsWith('.gz') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8')
  } catch { return null }

  const files = new Map<number, string>()
  const boxes: Box[] = []
  let page = 0
  let unit = 1
  for (const line of text.split('\n')) {
    if (line.startsWith('Input:')) {
      const m = line.match(/^Input:(\d+):(.*)$/)
      if (m) files.set(parseInt(m[1], 10), m[2].trim())
    } else if (line.startsWith('Unit:')) {
      const u = parseFloat(line.slice(5)); if (u > 0) unit = u
    } else if (line[0] === '{' || line[0] === '}') {
      const pg = parseInt(line.slice(1), 10); if (!isNaN(pg)) page = pg
    } else {
      const m = line.match(/^[hvxkg$@(]\s*(\d+),(\d+):(-?\d+),(-?\d+)/)
      if (m) {
        const tag = parseInt(m[1], 10), ln = parseInt(m[2], 10)
        const x = sp2pdf(parseInt(m[3], 10) * unit), y = sp2pdf(parseInt(m[4], 10) * unit)
        if (page > 0 && ln > 0) boxes.push({ page, x, y, line: ln, tag })
      }
    }
  }
  return boxes.length ? { files, boxes } : null
}

function load(p: string): Parsed | null {
  try {
    const mtime = statSync(p).mtimeMs
    const hit = cache.get(p)
    if (hit && hit.mtime === mtime) return hit.data
    const data = parse(p)
    if (data) cache.set(p, { mtime, data })
    return data
  } catch { return null }
}

export function synctexForward(synctexPath: string, sourceFile: string, line: number): { page: number; x: number; y: number } | null {
  const data = load(synctexPath); if (!data) return null
  const base = sourceFile.replace(/\\/g, '/').split('/').pop() || sourceFile
  const tags = new Set<number>()
  for (const [tag, f] of data.files) {
    const fb = f.replace(/\\/g, '/').split('/').pop() || f
    if (fb === base || f === sourceFile) tags.add(tag)
  }
  let best: Box | null = null
  for (const b of data.boxes) {
    if (tags.size && !tags.has(b.tag)) continue
    if (b.line < line) continue
    if (!best || b.line < best.line || (b.line === best.line && b.y < best.y)) best = b
  }
  if (!best) for (const b of data.boxes) {
    if (tags.size && !tags.has(b.tag)) continue
    if (!best || b.line > best.line) best = b
  }
  return best ? { page: best.page, x: best.x, y: best.y } : null
}

export function synctexInverse(synctexPath: string, page: number, x: number, y: number): { file: string; line: number } | null {
  const data = load(synctexPath); if (!data) return null
  let best: Box | null = null, bd = Infinity
  for (const b of data.boxes) {
    if (b.page !== page) continue
    const dx = b.x - x, dy = b.y - y, d = dx * dx + dy * dy
    if (d < bd) { bd = d; best = b }
  }
  return best ? { file: data.files.get(best.tag) || '', line: best.line } : null
}

export function registerSyncTexHandlers() {
  ipcMain.handle('synctex:forward', (_e, p: { synctexPath: string; sourceFile: string; line: number }) =>
    synctexForward(p.synctexPath, p.sourceFile, p.line))
  ipcMain.handle('synctex:inverse', (_e, p: { synctexPath: string; page: number; x: number; y: number }) =>
    synctexInverse(p.synctexPath, p.page, p.x, p.y))
}
