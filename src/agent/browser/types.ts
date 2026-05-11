/**
 * Agent-facing interface for the browser host service.
 *
 * The implementation lives in `src/main/browser-host.ts` (uses Electron
 * APIs that are only available in the main process). The agent layer,
 * which also runs in main but is meant to stay portable, imports only
 * this interface and looks up a registered implementation at runtime.
 *
 * That keeps agent code free of `electron` imports and makes it possible
 * to inject mocks for unit tests.
 */

/**
 * One node from the CDP `Accessibility.getFullAXTree` result, in the
 * compact normalized form we expose to consumers.
 */
export interface A11yNode {
  /** CDP-assigned id, stable within one snapshot only. */
  ref: string
  role: string
  name: string
  /** True if the node accepts focus / can be clicked or typed into. */
  interactive: boolean
  /** CDP backend DOM node id — needed for click/getBoxModel. */
  backendNodeId?: number
  childRefs: string[]
  parentRef?: string
}

export interface A11ySnapshot {
  nodes: A11yNode[]
  rootRef: string
}

/**
 * One open browser tab the agent can drive. Acquired via
 * `BrowserHost.acquireScratch()` (one-shot) or
 * `BrowserHost.acquireSession(id)` (sticky across calls).
 *
 * After use, scratch handles must be released. Session handles
 * auto-release on idle timeout but can be released early via
 * `BrowserHost.releaseSession(id)`.
 */
export interface PageHandle {
  /** Stable id for logging/telemetry. */
  readonly id: string

  navigate(url: string, opts?: NavigateOptions): Promise<void>
  getUrl(): string
  getTitle(): Promise<string>

  /**
   * Filtered, role-aware view of the page's accessibility tree —
   * structure preserved, decorative wrappers collapsed. Suitable for
   * `observe`-style tool calls.
   */
  getCompactA11y(): Promise<A11ySnapshot>

  /** Run Mozilla Readability inside the page; returns markdown-ish text. */
  getMarkdown(maxChars?: number): Promise<string>

  /** Plain `document.body.innerText`. The smallest extraction. */
  getInnerText(maxChars?: number): Promise<string>

  /** Real CDP-dispatched mouse click at the element's box-model center. */
  click(backendNodeId: number): Promise<void>

  /** Type into a focusable element. Clears existing value first. */
  type(backendNodeId: number, text: string): Promise<void>

  /** Submit the nearest form (or the form containing the given backendNodeId). */
  submit(backendNodeId?: number): Promise<void>

  scroll(direction: 'up' | 'down', amount?: number): Promise<void>

  /** Returns base64 PNG. */
  screenshot(opts?: { backendNodeId?: number }): Promise<string>

  /** Wait for a CSS selector or the given ms; whichever arrives first. */
  wait(opts: { ms?: number; selector?: string; timeoutMs?: number }): Promise<void>

  back(): Promise<void>
  forward(): Promise<void>

  /** Evaluate JS in page context. Use sparingly — most needs are covered by typed methods. */
  evaluate<T = unknown>(expression: string): Promise<T>
}

export interface NavigateOptions {
  /** Default 'load'. 'networkidle' adds ~500ms quiet-window detection. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
  /** Per-call timeout in ms (default 15000). */
  timeoutMs?: number
}

/**
 * Singleton service. The implementation:
 *   - lazily creates hidden browser windows on first acquire
 *   - shares a session-keyed pool for sticky `browse` use
 *   - hands out short-lived scratch pages for one-shot fetch/search
 *   - tracks recent failures for circuit-breaker decisions
 */
export interface BrowserHost {
  /**
   * True when the host is ready to serve calls right now. False when:
   *   - Electron `app` not yet ready
   *   - circuit-breaker is open after recent failures
   *   - user disabled the host in settings
   */
  isAvailable(): boolean

  /** Why is the host unavailable? `undefined` when available. */
  unavailableReason(): string | undefined

  acquireScratch(): Promise<PageHandle>
  releaseScratch(handle: PageHandle): Promise<void>

  acquireSession(sessionId: string): Promise<PageHandle>
  releaseSession(sessionId: string): Promise<void>

  /** Active page count, for telemetry/limits. */
  activePageCount(): number

  shutdown(): Promise<void>
}

let registered: BrowserHost | null = null

/** Called from the main process at app-ready. */
export function setBrowserHost(host: BrowserHost): void {
  registered = host
}

/**
 * Agent-side accessor. Returns `null` when no host is registered (e.g.
 * unit tests not running inside Electron, or pre-init). Callers should
 * gracefully degrade when this is `null`.
 */
export function getBrowserHost(): BrowserHost | null {
  return registered
}
