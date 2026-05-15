export interface ProviderConfig {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel: string
  modelStrong?: string
  modelBalanced?: string
  modelFast?: string
}

export const PRESET_PROVIDERS: Array<{
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  models: string[]
  testable: boolean
}> = [
  { id: 'openai', name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], testable: true },
  { id: 'anthropic', name: 'Claude (Anthropic)', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-opus-4-20250514'], testable: false },
  { id: 'deepseek', name: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], testable: true },
  { id: 'gemini', name: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.0-flash', 'gemini-2.0-pro'], testable: true },
  { id: 'groq', name: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b', 'gemma2-9b-it'], testable: true },
  { id: 'minimax-cn', name: 'Minimax (CN)', provider: 'openai', baseUrl: 'https://api.minimaxi.com/v1', models: ['abab6.5s-chat'], testable: true },
  { id: 'minimax-global', name: 'Minimax (Global)', provider: 'openai', baseUrl: 'https://api.minimaxi.com/v1', models: ['abab6.5s-chat'], testable: true },
  { id: 'kimi', name: 'Kimi (Moonshot)', provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-latest'], testable: true },
  { id: 'kimi-code', name: 'Kimi Code', provider: 'openai', baseUrl: 'https://api.kimi.com/coding/v1', models: ['kimi-for-coding'], testable: true },
  { id: 'glm', name: '智谱 GLM', provider: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4-flash'], testable: true },
  { id: 'local', name: '本地模型 (Ollama)', provider: 'openai', baseUrl: 'http://localhost:11434/v1', models: ['llama3', 'qwen2', 'mistral'], testable: true },
]

export interface ModelPreset {
  id: string
  name: string
  fastModel: string
  balancedModel: string
  strongModel: string
}

export interface ModelPresetsConfig {
  presets: ModelPreset[]
  activePresetId: string
}
