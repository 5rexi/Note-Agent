/**
 * Provider-format conversion utilities used by the OpenAI and Anthropic
 * stream clients.
 *
 * Kept framework-agnostic: only depends on shared `Message` / `ContentPart`
 * types. No fetch, no streaming, no provider-specific behavior here — just
 * the wire-format mapping each client needs to build its request body.
 */
import type { ContentPart } from '../types'

/** Crude vision capability detection by model name fragment. */
export function supportsVision(model: string): boolean {
  const visionModels = ['gpt-4o', 'claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4', 'gemini', 'qwen-vl']
  const lower = model.toLowerCase()
  return visionModels.some((v) => lower.includes(v))
}

export function toOpenAIContent(
  parts: ContentPart[],
): Array<{ type: string; text?: string; image_url?: { url: string } }> {
  return parts.map((p) => {
    if (p.type === 'text') return { type: 'text', text: p.text }
    return {
      type: 'image_url',
      image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` },
    }
  })
}

export function toAnthropicContent(
  parts: ContentPart[],
): Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> {
  return parts.map((p) => {
    if (p.type === 'text') return { type: 'text', text: p.text }
    return {
      type: 'image',
      source: { type: 'base64', media_type: p.source.media_type, data: p.source.data },
    }
  })
}
