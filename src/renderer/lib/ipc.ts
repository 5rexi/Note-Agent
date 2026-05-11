/**
 * Typed wrappers around `window.electronAPI` IPC calls.
 *
 * Most IPC calls in this codebase return either raw data or an
 * `{ error?, success?, ... }` envelope. Direct callers spread the
 * `result.error` checks all over the renderer; the helpers here
 * normalize that into a single throw-or-return pattern.
 *
 * Settings JSON (stored as strings in SQLite) is parsed and validated
 * with Zod schemas — preventing silent crashes from malformed values.
 */
import { z } from 'zod'

// ── Settings: schemas ───────────────────────────────────────────────────────

export const latexSupportSchema = z
  .object({
    enabled: z.boolean().optional(),
    compilerType: z.enum(['system-auto', 'system-manual', 'bundled']).optional(),
    compilerPath: z.string().optional(),
    bundledPath: z.string().optional(),
  })
  .passthrough()
export type LatexSupportConfig = z.infer<typeof latexSupportSchema>

export const wordSupportSchema = z
  .object({
    enabled: z.boolean().optional(),
    sofficeType: z.enum(['system-auto', 'system-manual', 'bundled']).optional(),
    sofficePath: z.string().optional(),
    bundledPath: z.string().optional(),
  })
  .passthrough()
export type WordSupportConfig = z.infer<typeof wordSupportSchema>

// ── Settings: helpers ───────────────────────────────────────────────────────

/**
 * Parse a JSON-serialized setting and validate against a Zod schema.
 * Returns the fallback (default `null`) on missing/malformed input.
 */
export function parseJsonSetting<T>(
  raw: unknown,
  schema: z.ZodType<T>,
): T | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** Load a setting from the main process and validate against a schema. */
export async function getJsonSetting<T>(
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await window.electronAPI.getSetting(key)
  return parseJsonSetting(raw, schema)
}

/** Persist a setting object as JSON. */
export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await window.electronAPI.setSetting(key, JSON.stringify(value))
}

// ── Envelope unwrapping ─────────────────────────────────────────────────────

export interface IpcEnvelope {
  error?: string
  success?: boolean
}

/**
 * Throws if the envelope reports an error; otherwise returns it unchanged.
 * Use as: `const r = unwrapIpc(await window.electronAPI.someOp(...))`.
 */
export function unwrapIpc<T extends IpcEnvelope>(envelope: T, label = 'IPC call'): T {
  if (envelope?.error) {
    throw new Error(`${label} failed: ${envelope.error}`)
  }
  return envelope
}

/** Read a file and unwrap, returning content directly. */
export async function readFile(path: string): Promise<string> {
  const r = await window.electronAPI.readFile(path)
  if (r.error) throw new Error(`readFile(${path}) failed: ${r.error}`)
  return r.content
}

/** Write a file and unwrap, throwing on error. */
export async function writeFile(path: string, content: string): Promise<void> {
  const r = await window.electronAPI.writeFile(path, content)
  if (r.error || !r.success) {
    throw new Error(`writeFile(${path}) failed: ${r.error ?? 'unknown error'}`)
  }
}
