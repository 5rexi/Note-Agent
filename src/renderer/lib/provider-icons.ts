/**
 * Provider Icons
 * Maps LLM provider IDs and base URLs to their brand icon paths.
 * Icons are served from /provider-icons/ (Vite public dir).
 */

const ICON_BASE = './provider-icons'

const providerIconMap: Record<string, string> = {
  openai: `${ICON_BASE}/openai.svg`,
  anthropic: `${ICON_BASE}/claude.svg`,
  deepseek: `${ICON_BASE}/openai.svg`, // fallback to generic
  gemini: `${ICON_BASE}/google.svg`,
  groq: `${ICON_BASE}/openai.svg`, // fallback to generic
  'minimax-cn': `${ICON_BASE}/minimax.svg`,
  'minimax-global': `${ICON_BASE}/minimax.svg`,
  minimax: `${ICON_BASE}/minimax.svg`,
  kimi: `${ICON_BASE}/kimi.svg`,
  'kimi-code': `${ICON_BASE}/kimi.svg`,
  glm: `${ICON_BASE}/google.svg`, // fallback
  local: `${ICON_BASE}/ollama.svg`,
  ollama: `${ICON_BASE}/ollama.svg`,
}

/** Detect provider from base URL for custom providers */
function detectProviderFromUrl(baseUrl: string): string | null {
  const url = baseUrl.toLowerCase()
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('anthropic.com')) return 'anthropic'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('google') || url.includes('gemini')) return 'gemini'
  if (url.includes('groq')) return 'groq'
  if (url.includes('minimax')) return 'minimax'
  if (url.includes('moonshot') || url.includes('kimi')) return 'kimi'
  if (url.includes('kimi.com/coding')) return 'kimi-code'
  if (url.includes('bigmodel') || url.includes('glm')) return 'glm'
  if (url.includes('ollama')) return 'ollama'
  if (url.includes('openrouter')) return 'openrouter'
  if (url.includes('mistral')) return 'mistral'
  if (url.includes('huggingface')) return 'huggingface'
  if (url.includes('azure')) return 'azure'
  if (url.includes('aws') || url.includes('bedrock')) return 'aws'
  return null
}

/** Get icon path for a provider */
export function getProviderIconPath(providerId: string, baseUrl?: string): string | null {
  // Direct lookup
  if (providerIconMap[providerId]) {
    return providerIconMap[providerId]
  }
  // URL-based detection for custom providers
  if (baseUrl) {
    const detected = detectProviderFromUrl(baseUrl)
    if (detected && providerIconMap[detected]) {
      return providerIconMap[detected]
    }
  }
  return null
}

/** Get display name for a provider */
export function getProviderDisplayName(providerId: string): string {
  const names: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    deepseek: 'DeepSeek',
    gemini: 'Google Gemini',
    groq: 'Groq',
    'minimax-cn': 'Minimax',
    'minimax-global': 'Minimax',
    minimax: 'Minimax',
    kimi: 'Kimi',
    'kimi-code': 'Kimi Code',
    glm: '智谱 GLM',
    local: '本地模型',
    ollama: 'Ollama',
  }
  return names[providerId] || providerId
}

/** Get brand color for a provider (for fallback circles) */
export function getProviderColor(providerId: string): string {
  const colors: Record<string, string> = {
    openai: '#10A37F',
    anthropic: '#D4A574',
    deepseek: '#4D6BFA',
    gemini: '#4285F4',
    groq: '#F55036',
    'minimax-cn': '#FF6B35',
    'minimax-global': '#FF6B35',
    minimax: '#FF6B35',
    kimi: '#1C1C1C',
    glm: '#3C5CFF',
    local: '#8B5CF6',
    ollama: '#FF6B6B',
  }
  return colors[providerId] || '#6B7280'
}
