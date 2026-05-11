import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { ProviderConfig, ModelPreset } from '../lib/providers'
import { getProviderIconPath, getProviderColor } from '../lib/provider-icons'

interface ModelSelectorProps {
  children: React.ReactNode
  selectedModel: string | null
  selectedTier: 'weak' | 'medium' | 'strong' | 'custom' | null
  onSelect: (params: {
    model: string
    tier?: 'weak' | 'medium' | 'strong' | 'custom'
    presetId?: string
  }) => void
}

type ActiveSelector = 'fast' | 'balanced' | 'strong' | 'default' | null

export default function ModelSelector({ children, selectedModel, selectedTier, onSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [presets, setPresets] = useState<ModelPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string>('default')
  const [tierModels, setTierModels] = useState<{ fast: string; balanced: string; strong: string }>({ fast: '', balanced: '', strong: '' })
  const [activeSelector, setActiveSelector] = useState<ActiveSelector>(null)
  const [popupPos, setPopupPos] = useState<{ left: number; top: number; maxHeight: number; placement: 'below' | 'above' }>({ left: 0, top: 0, maxHeight: 300, placement: 'below' })

  const panelRef = useRef<HTMLDivElement>(null)
  const fastRef = useRef<HTMLDivElement>(null)
  const balancedRef = useRef<HTMLDivElement>(null)
  const strongRef = useRef<HTMLDivElement>(null)
  const defaultRef = useRef<HTMLDivElement>(null)

  // Load settings
  useEffect(() => {
    if (!open) return
    async function load() {
      const [savedProviders, savedPresets] = await Promise.all([
        window.electronAPI.getSetting('llmProviders'),
        window.electronAPI.getSetting('modelPresets'),
      ])
      const parsedProviders = savedProviders ? JSON.parse(savedProviders) : []
      setProviders(parsedProviders)

      let presetList: ModelPreset[] = []
      let activeId = 'default'
      if (savedPresets) {
        try {
          const cfg = JSON.parse(savedPresets)
          presetList = cfg.presets || []
          activeId = cfg.activePresetId || 'default'
        } catch {}
      }
      if (presetList.length === 0) {
        presetList = [{ id: 'default', name: '默认', fastModel: '', balancedModel: '', strongModel: '' }]
      }
      setPresets(presetList)
      setActivePresetId(activeId)

      const preset = presetList.find((p: ModelPreset) => p.id === activeId)
      if (preset) {
        setTierModels({
          fast: preset.fastModel || '',
          balanced: preset.balancedModel || '',
          strong: preset.strongModel || '',
        })
      }
    }
    load()
  }, [open])

  // Close on click outside
  useEffect(() => {
    if (!open && !activeSelector) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveSelector(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, activeSelector])

  const allModels = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })))
  const activePreset = presets.find((p) => p.id === activePresetId)

  const handlePresetChange = (presetId: string) => {
    setActivePresetId(presetId)
    const preset = presets.find((p) => p.id === presetId)
    if (preset) {
      setTierModels({
        fast: preset.fastModel || '',
        balanced: preset.balancedModel || '',
        strong: preset.strongModel || '',
      })
      onSelect({ model: preset.fastModel || '', presetId })
    }
  }

  const handleTierModelChange = (tier: 'fast' | 'balanced' | 'strong', model: string) => {
    setTierModels((prev) => ({ ...prev, [tier]: model }))
    const tierMap = { fast: 'weak' as const, balanced: 'medium' as const, strong: 'strong' as const }
    onSelect({ model, tier: tierMap[tier] })
    setActiveSelector(null)
  }

  const handleDefaultModelChange = (model: string) => {
    onSelect({ model, tier: 'custom' as const })
    setActiveSelector(null)
  }

  const getModelDisplayName = (modelName: string) => {
    if (!modelName) return '未选择'
    const entry = allModels.find((m) => m.model === modelName)
    if (entry) return `${entry.provider.name} / ${modelName}`
    return modelName
  }

  const computePopupPosition = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const popupWidth = 240
    const popupHeight = 320
    const gap = 4
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    let left = rect.left
    if (left + popupWidth > viewportWidth - 8) {
      left = viewportWidth - popupWidth - 8
    }
    if (left < 8) left = 8

    const spaceBelow = viewportHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap

    let top: number
    let placement: 'below' | 'above'
    let maxHeight: number

    if (spaceBelow >= popupHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + gap
      placement = 'below'
      maxHeight = Math.min(popupHeight, spaceBelow)
    } else {
      top = rect.top - gap
      placement = 'above'
      maxHeight = Math.min(popupHeight, spaceAbove)
    }

    if (maxHeight < 120) maxHeight = 120

    setPopupPos({ left, top, maxHeight, placement })
  }, [])

  const toggleSelector = (selector: ActiveSelector, ref: React.RefObject<HTMLDivElement | null>) => {
    if (activeSelector === selector) {
      setActiveSelector(null)
      return
    }
    setActiveSelector(selector)
    if (ref.current) {
      computePopupPosition(ref.current)
    }
  }

  const ModelList = ({ onSelectModel }: { onSelectModel: (model: string) => void }) => (
    <div
      className="fixed z-[70] overflow-hidden"
      style={{
        left: popupPos.left,
        top: popupPos.placement === 'below' ? popupPos.top : undefined,
        bottom: popupPos.placement === 'above' ? window.innerHeight - popupPos.top : undefined,
        width: 240,
        maxHeight: popupPos.maxHeight,
        borderRadius: 'var(--na-radius-lg)',
        background: 'var(--na-bg-popover)',
        boxShadow: 'var(--na-shadow-lg)',
        border: '1px solid var(--na-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="overflow-y-auto flex-1" style={{ maxHeight: popupPos.maxHeight }}>
        {providers.length === 0 && (
          <div className="px-4 py-3 text-[12px] text-center" style={{ color: 'var(--na-text-tertiary)' }}>未配置 AI 厂商</div>
        )}
        {providers.map((provider) => (
          <div key={provider.id}>
            <div className="px-3 py-1.5 flex items-center gap-2 sticky top-0" style={{ background: 'var(--na-bg-popover)', borderBottom: '1px solid var(--na-border-subtle)' }}>
              {getProviderIconPath(provider.id, provider.baseUrl) ? (
                <img src={getProviderIconPath(provider.id, provider.baseUrl)!} alt="" className="w-4 h-4" style={{ objectFit: 'contain' }} />
              ) : (
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: getProviderColor(provider.id) }}>
                  {provider.name.charAt(0)}
                </div>
              )}
              <span className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>{provider.name}</span>
            </div>
            {provider.models.map((m) => (
              <button
                key={`${provider.id}-${m}`}
                onClick={() => onSelectModel(m)}
                className="w-full text-left px-4 py-2 text-[12px] transition-colors flex items-center gap-2"
                style={{ color: 'var(--na-text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--na-bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span className="flex-1 truncate">{m}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="relative" ref={panelRef}>
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {children}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 na-popover-appear"
            style={{
              right: 20,
              bottom: 80,
              width: 280,
              borderRadius: 'var(--na-radius-lg)',
              background: 'var(--na-bg-popover)',
              boxShadow: 'var(--na-shadow-lg)',
              border: '1px solid var(--na-border-subtle)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Complex Task Models */}
            <div className="shrink-0" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
              <div className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--na-text-tertiary)' }}>
                复杂任务模型
              </div>

              {/* Preset selector */}
              <div className="px-4 pb-2">
                <select
                  value={activePresetId}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full text-[12px] px-2 py-1.5 outline-none rounded-md"
                  style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-sidebar)', color: 'var(--na-text-primary)' }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Tier selectors */}
              <div className="px-4 pb-3 space-y-1">
                {([
                  { key: 'fast' as const, label: '快速', color: '#059669', ref: fastRef },
                  { key: 'balanced' as const, label: '平衡', color: '#F59E0B', ref: balancedRef },
                  { key: 'strong' as const, label: '专家', color: '#EF4444', ref: strongRef },
                ]).map((tier) => {
                  const modelValue = tierModels[tier.key]
                  const isActive = activeSelector === tier.key
                  return (
                    <div key={tier.key} className="relative" ref={tier.ref}>
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer"
                        style={{ background: isActive ? 'var(--na-bg-hover)' : 'transparent' }}
                        onClick={() => toggleSelector(tier.key, tier.ref)}
                      >
                        <span className="text-[12px] w-14 shrink-0" style={{ color: tier.color }}>{tier.label}</span>
                        <div className="flex-1 text-[12px] truncate flex items-center gap-1" style={{ color: 'var(--na-text-primary)' }}>
                          <span className="truncate">{getModelDisplayName(modelValue)}</span>
                          <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)', transform: isActive ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Default Model */}
            <div className="shrink-0">
              <div className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--na-text-tertiary)' }}>
                默认模型
              </div>
              <div className="px-4 pb-3">
                <div className="relative" ref={defaultRef}>
                  <div
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer"
                    style={{ background: activeSelector === 'default' ? 'var(--na-bg-hover)' : 'transparent' }}
                    onClick={() => toggleSelector('default', defaultRef)}
                  >
                    <div className="flex-1 text-[12px] truncate flex items-center gap-1" style={{ color: 'var(--na-text-primary)' }}>
                      <span className="truncate">{getModelDisplayName(selectedModel || '')}</span>
                      <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--na-text-tertiary)', transform: activeSelector === 'default' ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active model list popup (fixed positioned, outside the panel) */}
          {activeSelector && activeSelector !== 'default' && (
            <ModelList
              onSelectModel={(model) => {
                handleTierModelChange(activeSelector as 'fast' | 'balanced' | 'strong', model)
              }}
            />
          )}
          {activeSelector === 'default' && (
            <ModelList
              onSelectModel={(model) => {
                handleDefaultModelChange(model)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
