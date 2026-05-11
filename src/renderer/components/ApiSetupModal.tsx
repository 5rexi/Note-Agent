import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { PRESET_PROVIDERS, type ProviderConfig } from '../lib/providers'
import { getProviderIconPath, getProviderDisplayName, getProviderColor } from '../lib/provider-icons'

interface ApiSetupModalProps {
  open: boolean
  existingProviders: ProviderConfig[]
  onClose: () => void
  onComplete: (provider: ProviderConfig) => void
}

type Step = 'config' | 'testing' | 'select-model'

function genId() {
  return crypto.randomUUID()
}

export default function ApiSetupModal({ open, existingProviders, onClose, onComplete }: ApiSetupModalProps) {
  const [step, setStep] = useState<Step>('config')
  const [selectedPresetId, setSelectedPresetId] = useState<string>('openai')
  const [isCustom, setIsCustom] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customFormat, setCustomFormat] = useState<'openai' | 'anthropic'>('openai')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [reasoning, setReasoning] = useState<'fast' | 'balanced' | 'strong'>('balanced')
  const [testError, setTestError] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const abortRef = useRef(false)

  const isFirstProvider = existingProviders.length === 0

  // Reset state when opened
  useEffect(() => {
    if (!open) return
    setStep('config')
    setSelectedPresetId('openai')
    setIsCustom(false)
    setApiKey('')
    setCustomName('')
    setCustomBaseUrl('')
    setCustomFormat('openai')
    setModels([])
    setSelectedModel('')
    setReasoning('balanced')
    setTestError('')
    setIsTesting(false)
    abortRef.current = false
  }, [open])

  const handleClose = useCallback(() => {
    abortRef.current = true
    onClose()
  }, [onClose])

  const currentPreset = PRESET_PROVIDERS.find((p) => p.id === selectedPresetId)

  const providerForTest = isCustom
    ? { provider: customFormat, baseUrl: customBaseUrl }
    : { provider: currentPreset?.provider || 'openai', baseUrl: currentPreset?.baseUrl || '' }

  const canContinue = isCustom
    ? apiKey.trim().length > 0 && customBaseUrl.trim().length > 0 && customName.trim().length > 0
    : apiKey.trim().length > 0

  const handleContinue = async () => {
    if (!canContinue) return
    setStep('testing')
    setIsTesting(true)
    setTestError('')
    abortRef.current = false

    try {
      const result = await window.electronAPI.agentListModels(
        providerForTest.provider,
        providerForTest.baseUrl,
        apiKey,
      )

      if (abortRef.current) return

      if (result.error) {
        setTestError(result.error)
        setIsTesting(false)
        setStep('config')
        return
      }

      const fetchedModels = result.models.length > 0 ? result.models : (currentPreset?.models || [])
      setModels(fetchedModels)

      if (!isFirstProvider) {
        // Not first provider — complete immediately with defaults
        const provider = buildProvider(fetchedModels, fetchedModels[0] || '')
        onComplete(provider)
        return
      }

      // First provider — go to model selection
      setSelectedModel(fetchedModels[0] || '')
      setStep('select-model')
      setIsTesting(false)
    } catch (e: any) {
      if (abortRef.current) return
      setTestError(e.message || '测试失败')
      setIsTesting(false)
      setStep('config')
    }
  }

  const buildProvider = (modelList: string[], defaultModel: string): ProviderConfig => {
    const preset = isCustom
      ? { id: 'custom', name: customName, provider: customFormat, baseUrl: customBaseUrl }
      : currentPreset!

    return {
      id: genId(),
      name: preset.name,
      provider: preset.provider as 'openai' | 'anthropic',
      baseUrl: preset.baseUrl,
      apiKey,
      models: modelList,
      defaultModel,
      modelFast: defaultModel,
      modelBalanced: defaultModel,
      modelStrong: defaultModel,
    }
  }

  const handleFinish = () => {
    if (!selectedModel) return
    const provider = buildProvider(models, selectedModel)
    onComplete(provider)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: '#f8f9fa' }}>
      <div className="w-full max-w-[480px] px-6">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="fixed top-6 left-6 p-2 rounded-lg transition-colors hover:bg-black/5"
          style={{ color: '#6B7280' }}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[
            { key: 'config', label: '配置' },
            { key: 'testing', label: '测试' },
            ...(isFirstProvider ? [{ key: 'select-model', label: '选模型' }] : []),
          ].map((s, idx, arr) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium"
                style={{
                  background: step === s.key || (step === 'select-model' && s.key === 'config') || (step === 'select-model' && s.key === 'testing')
                    ? 'var(--na-accent)'
                    : step === 'config' && s.key !== 'config'
                      ? 'var(--na-border-default)'
                      : 'var(--na-accent)',
                  color: step === s.key || (step !== 'config' && (s.key === 'config' || s.key === 'testing')) ? '#fff' : 'var(--na-text-tertiary)',
                }}
              >
                {step !== 'config' && (s.key === 'config' || (step === 'select-model' && s.key === 'testing')) ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  idx + 1
                )}
              </div>
              <span className="text-[11px]" style={{ color: step === s.key ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)' }}>
                {s.label}
              </span>
              {idx < arr.length - 1 && (
                <div className="w-8 h-px mx-1" style={{ background: 'var(--na-border-default)' }} />
              )}
            </div>
          ))}
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h2 className="text-[20px] font-semibold mb-2" style={{ color: 'var(--na-text-primary)' }}>
            {step === 'config' && 'API 配置'}
            {step === 'testing' && '正在测试连接'}
            {step === 'select-model' && '选择默认模型'}
          </h2>
          <p className="text-[13px]" style={{ color: 'var(--na-text-tertiary)' }}>
            {step === 'config' && '添加你的 AI 厂商 API，所有数据仅存储在本地'}
            {step === 'testing' && '正在验证 API Key 并获取可用模型列表'}
            {step === 'select-model' && '选择默认使用的模型和思考强度'}
          </p>
        </div>

        {/* === Step 1: Config === */}
        {step === 'config' && (
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>厂商</label>
              <select
                value={isCustom ? 'custom' : selectedPresetId}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'custom') {
                    setIsCustom(true)
                  } else {
                    setIsCustom(false)
                    setSelectedPresetId(val)
                  }
                }}
                className="w-full text-[13px] px-3 py-2.5 outline-none rounded-lg"
                style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
              >
                {PRESET_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="custom">自定义 (OpenAI 兼容)</option>
              </select>
            </div>

            {/* Custom provider fields */}
            {isCustom && (
              <>
                <div>
                  <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>显示名称</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="例如：我的自定义 API"
                    className="w-full text-[13px] px-3 py-2.5 outline-none rounded-lg"
                    style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>Base URL</label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full text-[13px] px-3 py-2.5 outline-none rounded-lg"
                    style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>API 格式</label>
                  <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-subtle)' }}>
                    {([
                      { key: 'openai' as const, label: 'OpenAI 兼容' },
                      { key: 'anthropic' as const, label: 'Anthropic' },
                    ]).map((fmt) => (
                      <button
                        key={fmt.key}
                        onClick={() => setCustomFormat(fmt.key)}
                        className="flex-1 py-2 text-[12px] font-medium text-center transition-colors rounded-md"
                        style={{
                          background: customFormat === fmt.key ? 'var(--na-bg-active)' : 'transparent',
                          color: customFormat === fmt.key ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)',
                        }}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* API Key */}
            <div>
              <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestError('') }}
                placeholder="sk-..."
                className="w-full text-[13px] px-3 py-2.5 outline-none rounded-lg"
                style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
              />
            </div>

            {/* Error */}
            {testError && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: '#EF4444' }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{testError}</span>
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-3 pt-4">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-colors"
                style={{ border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
              >
                返回
              </button>
              <button
                onClick={handleContinue}
                disabled={!canContinue}
                className="flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-colors"
                style={{
                  background: canContinue ? 'var(--na-accent)' : 'var(--na-border-default)',
                  color: canContinue ? '#fff' : 'var(--na-text-tertiary)',
                }}
              >
                继续
              </button>
            </div>
          </div>
        )}

        {/* === Step 2: Testing === */}
        {step === 'testing' && (
          <div className="text-center py-8 space-y-4">
            <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: 'var(--na-accent)' }} />
            <p className="text-[14px]" style={{ color: 'var(--na-text-secondary)' }}>
              正在连接 {isCustom ? customName : currentPreset?.name}...
            </p>
            <button
              onClick={handleClose}
              className="px-5 py-2 text-[13px] rounded-lg transition-colors"
              style={{ border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
            >
              返回
            </button>
          </div>
        )}

        {/* === Step 3: Select default model === */}
        {step === 'select-model' && (
          <div className="space-y-5">
            {/* Default model */}
            <div>
              <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>默认模型</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full text-[13px] px-3 py-2.5 outline-none rounded-lg"
                style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Reasoning slider */}
            <div>
              <label className="text-[12px] font-medium block mb-2" style={{ color: 'var(--na-text-secondary)' }}>思考强度</label>
              <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-subtle)' }}>
                {([
                  { key: 'fast' as const, label: '快速', desc: '快速响应' },
                  { key: 'balanced' as const, label: '平衡', desc: '标准能力' },
                  { key: 'strong' as const, label: '专家', desc: '深度推理' },
                ]).map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setReasoning(r.key)}
                    className="flex-1 py-2 text-center transition-colors rounded-md"
                    style={{
                      background: reasoning === r.key ? 'var(--na-bg-active)' : 'transparent',
                    }}
                  >
                    <div className="text-[12px] font-medium" style={{ color: reasoning === r.key ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)' }}>
                      {r.label}
                    </div>
                    <div className="text-[10px]" style={{ color: reasoning === r.key ? 'var(--na-text-secondary)' : 'var(--na-text-tertiary)' }}>
                      {r.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-3 pt-4">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-colors"
                style={{ border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
              >
                返回
              </button>
              <button
                onClick={handleFinish}
                disabled={!selectedModel}
                className="flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-colors"
                style={{
                  background: selectedModel ? 'var(--na-accent)' : 'var(--na-border-default)',
                  color: selectedModel ? '#fff' : 'var(--na-text-tertiary)',
                }}
              >
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
