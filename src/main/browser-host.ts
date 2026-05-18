/**
 * Browser host — Electron-side implementation of the agent's BrowserHost
 * interface. Drives hidden BrowserWindows via the Chrome DevTools Protocol
 * (webContents.debugger), no Puppeteer.
 *
 * Why this exists:
 *   1. Search engines and many static pages serve anti-bot CAPTCHAs to
 *      data-center / non-browser HTTP clients. A real (hidden) Chromium
 *      browser bypasses that.
 *   2. We're already shipping Chromium for the renderer, so adding more
 *      hidden windows costs ~10MB per page rather than another 150MB
 *      Chromium download.
 *   3. CDP gives us first-class accessibility-tree extraction and
 *      coordinate-level mouse events — both essential for the upcoming
 *      `browse` agent tool.
 *
 * Lifecycle:
 *   - Lazy: first acquire creates a window
 *   - Idle: per-window 5-min timeout closes inactive windows
 *   - Pool: scratch (one-shot) and session-keyed (sticky)
 *   - Quit: `shutdown()` closes everything
 *
 * Failure handling:
 *   - Per-call timeouts (configurable per method)
 *   - Circuit-breaker on consecutive failures (3 in 60s → open for 60s)
 *   - Tainted handles are destroyed and not reused
 */
import { BrowserWindow } from 'electron'
import type {
  A11ySnapshot,
  BrowserHost,
  NavigateOptions,
  PageHandle,
} from '../agent/browser/types'
import { setBrowserHost } from '../agent/browser/types'
import { compactA11y } from '../agent/browser/compactA11y'

const IDLE_SHUTDOWN_MS = 5 * 60 * 1000
const DEFAULT_NAV_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 10_000
const CIRCUIT_THRESHOLD = 3
const CIRCUIT_WINDOW_MS = 60_000
const CIRCUIT_OPEN_MS = 60_000
const MAX_CONCURRENT_PAGES = 4

interface CdpFn {
  (method: string, params?: unknown): Promise<any>
}

/* -------------------------------------------------------------------------- */
/* Per-page wrapper                                                             */
/* -------------------------------------------------------------------------- */

class HiddenPage implements PageHandle {
  public readonly id: string
  private win: BrowserWindow | null
  private send: CdpFn
  private tainted = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private domainsEnabled = new Set<string>()

  constructor(id: string, win: BrowserWindow) {
    this.id = id
    this.win = win
    this.send = (method, params) => {
      if (!this.win || this.win.isDestroyed()) {
        throw new Error(`page ${this.id} destroyed`)
      }
      return this.win.webContents.debugger.sendCommand(method, params || {})
    }
  }

  /** Enable a CDP domain at most once per page. */
  private async enableDomain(name: string): Promise<void> {
    if (this.domainsEnabled.has(name)) return
    await this.send(`${name}.enable`)
    this.domainsEnabled.add(name)
  }

  /** Reset the idle timer when the page is touched. */
  touch(idleMs: number, onIdle: () => void): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(onIdle, idleMs)
  }

  cancelIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /**
   * Detach the underlying BrowserWindow from this handle and return it
   * to the pool manager. The pool decides whether to recycle (about:blank)
   * or destroy (shutdown).
   */
  detachWin(): BrowserWindow | null {
    this.cancelIdle()
    const w = this.win
    this.win = null
    this.tainted = true
    return w
  }

  isTainted(): boolean { return this.tainted }

  private mark(err: unknown): never {
    this.tainted = true
    throw err instanceof Error ? err : new Error(String(err))
  }

  /* ── PageHandle implementation ─────────────────────────────────────────── */

  async navigate(url: string, opts: NavigateOptions = {}): Promise<void> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    const timeoutMs = opts.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS
    try {
      await withTimeout(this.win.loadURL(url), timeoutMs, `loadURL(${url})`)
      if (opts.waitUntil === 'networkidle') {
        await this.waitForNetworkIdle(2000, timeoutMs)
      }
      // Settle: on the *first* load of a URL in this Chromium process,
      // input events dispatched too quickly are dropped — the renderer
      // frame's input pipeline isn't fully connected even though
      // `did-finish-load` has fired. Subsequent reloads are cached and
      // input-ready immediately. 600ms is conservative enough to handle
      // cold cases without making warm cases noticeably slower than the
      // user expects from a navigation.
      await new Promise((r) => setTimeout(r, 600))
    } catch (e) {
      this.mark(e)
    }
  }

  getUrl(): string {
    return this.win?.isDestroyed() ? '' : (this.win?.webContents.getURL() ?? '')
  }

  async getTitle(): Promise<string> {
    if (!this.win || this.win.isDestroyed()) return ''
    return this.win.webContents.getTitle()
  }

  async getCompactA11y(): Promise<A11ySnapshot> {
    try {
      await this.enableDomain('Accessibility')
      const result = await this.send('Accessibility.getFullAXTree')
      return compactA11y(result.nodes || [])
    } catch (e) {
      this.mark(e)
    }
  }

  async getMarkdown(maxChars: number = 8000): Promise<string> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try {
      // Inline Readability-lite: pick best candidate, strip noise.
      // (We avoid bundling @mozilla/readability into main here; W2 will
      // promote this to a real Readability run.)
      const text = await withTimeout(
        this.win.webContents.executeJavaScript(READABILITY_LITE_JS, true),
        DEFAULT_CALL_TIMEOUT_MS,
        'getMarkdown',
      )
      const s = String(text || '')
      return s.length > maxChars ? s.slice(0, maxChars) + '\n\n[…truncated]' : s
    } catch (e) {
      this.mark(e)
    }
  }

  async getInnerText(maxChars: number = 8000): Promise<string> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try {
      const text = await withTimeout(
        this.win.webContents.executeJavaScript('document.body && document.body.innerText || ""'),
        DEFAULT_CALL_TIMEOUT_MS,
        'getInnerText',
      )
      const s = String(text || '')
      return s.length > maxChars ? s.slice(0, maxChars) + '\n\n[…truncated]' : s
    } catch (e) {
      this.mark(e)
    }
  }

  async click(backendNodeId: number): Promise<void> {
    try {
      await this.enableDomain('DOM')
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
      const box = await this.send('DOM.getBoxModel', { backendNodeId })
      const c = box.model?.content as number[] | undefined
      if (!c || c.length < 8) throw new Error('element has no box (offscreen?)')
      const cx = (c[0] + c[2] + c[4] + c[6]) / 4
      const cy = (c[1] + c[3] + c[5] + c[7]) / 4
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy })
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1 })
      // Brief delay between press and release — instant clicks are filtered
      // by some sites' handlers (and Chromium's own coalescing logic).
      await new Promise((r) => setTimeout(r, 50))
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
    } catch (e) {
      this.mark(e)
    }
  }

  async type(backendNodeId: number, text: string): Promise<void> {
    try {
      await this.send('DOM.focus', { backendNodeId })
      // Clear by selecting all then deleting; works across input/textarea/contenteditable.
      const platform = process.platform === 'darwin' ? 'Meta' : 'Control'
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: platform === 'Meta' ? 4 : 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: platform === 'Meta' ? 4 : 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
      await this.send('Input.insertText', { text })
    } catch (e) {
      this.mark(e)
    }
  }

  async submit(backendNodeId?: number): Promise<void> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try {
      const expr = backendNodeId
        ? `(() => {
             const els = document.querySelectorAll('*');
             // We can't pass a backendNodeId from the page; fall back to focused-form submit.
             const form = (document.activeElement && document.activeElement.closest('form')) || document.querySelector('form');
             if (form) { form.submit(); return true; }
             return false;
           })()`
        : `(() => { const f = document.querySelector('form'); if (f) { f.submit(); return true; } return false; })()`
      await withTimeout(this.win.webContents.executeJavaScript(expr), DEFAULT_CALL_TIMEOUT_MS, 'submit')
    } catch (e) {
      this.mark(e)
    }
  }

  async scroll(direction: 'up' | 'down', amount: number = 600): Promise<void> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    const delta = direction === 'down' ? amount : -amount
    try {
      await this.win.webContents.executeJavaScript(`window.scrollBy(0, ${delta})`)
    } catch (e) {
      this.mark(e)
    }
  }

  async screenshot(opts?: { backendNodeId?: number }): Promise<string> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try {
      if (opts?.backendNodeId !== undefined) {
        const box = await this.send('DOM.getBoxModel', { backendNodeId: opts.backendNodeId })
        const c = box.model?.content as number[]
        const x = Math.min(c[0], c[2], c[4], c[6])
        const y = Math.min(c[1], c[3], c[5], c[7])
        const x2 = Math.max(c[0], c[2], c[4], c[6])
        const y2 = Math.max(c[1], c[3], c[5], c[7])
        const result = await this.send('Page.captureScreenshot', {
          clip: { x, y, width: x2 - x, height: y2 - y, scale: 1 },
          format: 'png',
        })
        return result.data as string
      }
      const result = await this.send('Page.captureScreenshot', { format: 'png' })
      return result.data as string
    } catch (e) {
      this.mark(e)
    }
  }

  async wait(opts: { ms?: number; selector?: string; timeoutMs?: number }): Promise<void> {
    if (opts.ms !== undefined && !opts.selector) {
      await new Promise((r) => setTimeout(r, opts.ms))
      return
    }
    if (!opts.selector) return
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    const timeoutMs = opts.timeoutMs ?? 5000
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const found = await this.win.webContents.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(opts.selector)})`,
      )
      if (found) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`wait: selector not found within ${timeoutMs}ms: ${opts.selector}`)
  }

  async back(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try { this.win.webContents.navigationHistory.goBack() } catch (e) { this.mark(e) }
  }

  async forward(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try { this.win.webContents.navigationHistory.goForward() } catch (e) { this.mark(e) }
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    if (!this.win || this.win.isDestroyed()) throw new Error('page destroyed')
    try {
      const result = await withTimeout(
        this.win.webContents.executeJavaScript(expression),
        DEFAULT_CALL_TIMEOUT_MS,
        'evaluate',
      )
      return result as T
    } catch (e) {
      this.mark(e)
    }
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  private async waitForNetworkIdle(idleMs: number, totalTimeoutMs: number): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    const wc = this.win.webContents
    let lastActivity = Date.now()
    const onActivity = () => { lastActivity = Date.now() }
    wc.on('did-start-loading', onActivity)
    wc.on('did-stop-loading', onActivity)
    const start = Date.now()
    try {
      while (Date.now() - start < totalTimeoutMs) {
        if (Date.now() - lastActivity >= idleMs) return
        await new Promise((r) => setTimeout(r, 100))
      }
    } finally {
      wc.off('did-start-loading', onActivity)
      wc.off('did-stop-loading', onActivity)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Inlined Readability-lite — runs inside the page                             */
/* -------------------------------------------------------------------------- */

const READABILITY_LITE_JS = `(() => {
  function score(el) {
    const text = el.textContent || '';
    let s = text.length / 80;
    s += (el.querySelectorAll('p').length || 0) * 3;
    s -= (el.querySelectorAll('a').length || 0) * 0.5;
    return s;
  }
  let best = document.body, bestScore = 0;
  for (const el of document.querySelectorAll('article, main, [role=main], .content, .post-content, #content, .entry-content')) {
    const s = score(el);
    if (s > bestScore) { best = el; bestScore = s; }
  }
  if (bestScore < 5) {
    for (const el of document.querySelectorAll('div, section')) {
      const s = score(el);
      if (s > bestScore) { best = el; bestScore = s; }
    }
  }
  const clone = best.cloneNode(true);
  for (const sel of ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg', '[role=navigation]', '.sidebar', '.ads', '.advertisement', 'iframe']) {
    for (const e of clone.querySelectorAll(sel)) e.remove();
  }
  // Roll up to a markdown-ish form.
  const lines = [];
  function visit(n) {
    if (n.nodeType === 3) { lines.push(n.textContent); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'h1') { lines.push('\\n# ' + n.textContent.trim()); return; }
    if (tag === 'h2') { lines.push('\\n## ' + n.textContent.trim()); return; }
    if (tag === 'h3') { lines.push('\\n### ' + n.textContent.trim()); return; }
    if (tag === 'h4' || tag === 'h5' || tag === 'h6') { lines.push('\\n#### ' + n.textContent.trim()); return; }
    if (tag === 'p') { lines.push('\\n' + n.textContent.trim() + '\\n'); return; }
    if (tag === 'li') { lines.push('- ' + n.textContent.trim()); return; }
    if (tag === 'a' && n.href) { lines.push((n.textContent || n.href) + ' (' + n.href + ')'); return; }
    if (tag === 'br') { lines.push('\\n'); return; }
    for (const c of n.childNodes) visit(c);
  }
  visit(clone);
  return lines.join('').replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]+/g, ' ').trim();
})()`

/* -------------------------------------------------------------------------- */
/* The host singleton                                                          */
/* -------------------------------------------------------------------------- */

interface FailureRecord {
  at: number
  reason: string
}

/**
 * Pooled BrowserWindow lifecycle.
 *
 * On Electron+WSL2 (and possibly other configs), destroying a BrowserWindow
 * leaves the shared network session in a bad state, causing subsequent
 * `loadURL` on freshly-created windows to fail with ERR_FAILED. A pure
 * pure-Electron repro confirmed this is not caused by our debugger usage.
 *
 * Workaround = the right design anyway: pool windows and recycle them
 * via about:blank. We only destroy on full shutdown.
 */
interface PooledWindow {
  win: BrowserWindow
  inUse: boolean
  pageId?: string
}

class BrowserHostImpl implements BrowserHost {
  private nextId = 0
  private pool: PooledWindow[] = []
  private scratch = new Set<HiddenPage>()
  private sessions = new Map<string, HiddenPage>()
  private failures: FailureRecord[] = []
  private circuitOpenUntil = 0
  private disabled = false

  isAvailable(): boolean {
    return !this.unavailableReason()
  }

  unavailableReason(): string | undefined {
    if (this.disabled) return 'host disabled by settings'
    if (Date.now() < this.circuitOpenUntil) {
      const wait = Math.ceil((this.circuitOpenUntil - Date.now()) / 1000)
      return `circuit-breaker open for ${wait}s after recent failures`
    }
    if (this.activePageCount() >= MAX_CONCURRENT_PAGES) {
      return `at max concurrent pages (${MAX_CONCURRENT_PAGES})`
    }
    return undefined
  }

  activePageCount(): number {
    return this.scratch.size + this.sessions.size
  }

  async acquireScratch(): Promise<PageHandle> {
    this.guardAvailable()
    const win = await this.checkoutPooledWindow()
    const page = new HiddenPage(`p${this.nextId++}`, win)
    this.scratch.add(page)
    page.touch(IDLE_SHUTDOWN_MS, () => this.releaseScratch(page).catch(() => {}))
    return page
  }

  async releaseScratch(handle: PageHandle): Promise<void> {
    const page = handle as HiddenPage
    if (!this.scratch.has(page)) return
    this.scratch.delete(page)
    await this.recyclePooledWindow(page)
  }

  async acquireSession(sessionId: string): Promise<PageHandle> {
    const existing = this.sessions.get(sessionId)
    if (existing && !existing.isTainted()) {
      existing.touch(IDLE_SHUTDOWN_MS, () => this.releaseSession(sessionId).catch(() => {}))
      return existing
    }
    if (existing) {
      // tainted — recycle, then drop the session entry
      this.sessions.delete(sessionId)
      await this.recyclePooledWindow(existing).catch(() => {})
    }
    this.guardAvailable()
    const win = await this.checkoutPooledWindow()
    const page = new HiddenPage(`s:${sessionId}:${this.nextId++}`, win)
    this.sessions.set(sessionId, page)
    page.touch(IDLE_SHUTDOWN_MS, () => this.releaseSession(sessionId).catch(() => {}))
    return page
  }

  async releaseSession(sessionId: string): Promise<void> {
    const page = this.sessions.get(sessionId)
    if (!page) return
    this.sessions.delete(sessionId)
    await this.recyclePooledWindow(page)
  }

  async shutdown(): Promise<void> {
    for (const p of this.scratch) p.detachWin()
    this.scratch.clear()
    for (const [, p] of this.sessions) p.detachWin()
    this.sessions.clear()
    for (const slot of this.pool) {
      if (!slot.win.isDestroyed()) slot.win.destroy()
    }
    this.pool = []
  }

  recordFailure(reason: string): void {
    const now = Date.now()
    this.failures = this.failures.filter((f) => now - f.at < CIRCUIT_WINDOW_MS)
    this.failures.push({ at: now, reason })
    if (this.failures.length >= CIRCUIT_THRESHOLD) {
      this.circuitOpenUntil = now + CIRCUIT_OPEN_MS
      this.failures = []
      console.warn(`[browser-host] Circuit-breaker tripped (${CIRCUIT_THRESHOLD} failures in ${CIRCUIT_WINDOW_MS / 1000}s). Pausing for ${CIRCUIT_OPEN_MS / 1000}s.`)
    }
  }

  setDisabled(value: boolean): void {
    this.disabled = value
  }

  private guardAvailable(): void {
    const reason = this.unavailableReason()
    if (reason) throw new Error(`browser-host unavailable: ${reason}`)
  }

  /**
   * Hand out a pooled window, creating a new one only if the pool is full
   * of in-use windows (up to MAX_CONCURRENT_PAGES).
   */
  private async checkoutPooledWindow(): Promise<BrowserWindow> {
    const free = this.pool.find((s) => !s.inUse && !s.win.isDestroyed())
    if (free) {
      free.inUse = true
      return free.win
    }
    if (this.pool.length >= MAX_CONCURRENT_PAGES) {
      throw new Error('window pool exhausted')
    }
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: false,
      },
    })
    try {
      win.webContents.debugger.attach('1.3')
    } catch {
      // already attached or not supported — proceed
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.pool.push({ win, inUse: true })
    return win
  }

  /**
   * Send the page's window back to the pool. We navigate to about:blank to
   * tear down the previous page state (cookies persist for the session by
   * default, which is fine — sessions are isolated already).
   */
  private async recyclePooledWindow(page: HiddenPage): Promise<void> {
    const win = page.detachWin()
    if (!win || win.isDestroyed()) return
    const slot = this.pool.find((s) => s.win === win)
    if (!slot) return
    try {
      await win.loadURL('about:blank')
    } catch {
      // ignore — slot still usable; about:blank rarely fails
    }
    slot.inUse = false
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry                                                                 */
/* -------------------------------------------------------------------------- */

export const browserHost = new BrowserHostImpl()

/** Call from main process at app-ready to register the host with agent code. */
export function registerBrowserHost(): void {
  setBrowserHost(browserHost)
}

/**
 * Sync the host's disabled flag from a settings store. Call this at startup
 * and whenever settings change so the user toggle takes effect immediately.
 */
export function syncBrowserHostFromSettings(getSetting: (key: string) => string | null | undefined): void {
  const v = getSetting('browserHostDisabled')
  browserHost.setDisabled(v === 'true')
}
