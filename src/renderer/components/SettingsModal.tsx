import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useT } from '../hooks/useT'
import {
  X, Plus, Trash2, Pencil, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Sparkles, Cable, Palette, Monitor, Type, ZoomIn, Settings, FolderOpen, FileText, User, Bot,
  FileType, Search, FolderInput, Download, Loader2, CheckCircle2, AlertCircle, Globe,
  FlaskConical, Terminal, Info,
} from 'lucide-react'
import type { ProviderConfig, ModelPreset, ModelPresetsConfig } from '../lib/providers'
import { PRESET_PROVIDERS } from '../lib/providers'
import { getProviderIconPath, getProviderDisplayName, getProviderColor } from '../lib/provider-icons'
import ApiSetupModal from './ApiSetupModal'
import LaTeXSupportCard from './LaTeXSupportCard'
import WordSupportCard from './WordSupportCard'
import { toast } from 'sonner'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  sidebarCollapsed: boolean
  sidebarWidth: number
  onSettingsChange?: () => void
}

interface AppearanceConfig {
  theme: 'light' | 'dark' | 'system'
  uiFont: string
  editorFont: string
  editorFontSize: number
  scale: number
  lang: 'zh' | 'en' | 'ja'
}

interface DefaultConfig {
  providerId: string
  model: string
  reasoning: 'fast' | 'balanced' | 'strong'
}

interface GeneralConfig {
  reportEnabled: boolean
  reportDir: string
  reportStyleFile: string
  reportStyleDesc: string
  reportCategorizeModel?: string
  reportGenerateModel?: string
  userName: string
  agentName: string
  userProfile: string
}

export default function SettingsModal({ open, onClose, sidebarCollapsed, sidebarWidth, onSettingsChange }: SettingsModalProps) {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [appearance, setAppearance] = useState<AppearanceConfig>({
    theme: 'light',
    uiFont: 'system',
    editorFont: 'jetbrains-mono',
    editorFontSize: 14,
    scale: 1,
    lang: 'zh',
  })
  const [defaultConfig, setDefaultConfig] = useState<DefaultConfig>({
    providerId: '',
    model: '',
    reasoning: 'balanced',
  })
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    reportEnabled: false,
    reportDir: '',
    reportStyleFile: '',
    reportStyleDesc: '',
    reportCategorizeModel: '',
    reportGenerateModel: '',
    userName: '您',
    agentName: 'Note Agent',
    userProfile: '',
  })
  const [presets, setPresets] = useState<ModelPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string>('default')
  const [activeTab, setActiveTab] = useState<'connection' | 'appearance' | 'general' | 'fileSupport' | 'web' | 'research' | 'about'>('connection')
  const [showApiSetup, setShowApiSetup] = useState(false)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [renamingProviderId, setRenamingProviderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showAddPreset, setShowAddPreset] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')

  // LaTeX support config
  const [latexConfig, setLatexConfig] = useState<{
    enabled: boolean
    compilerType: 'system-auto' | 'system-manual' | 'bundled' | null
    compilerPath: string
    bundledPath: string
  }>({
    enabled: false,
    compilerType: null,
    compilerPath: '',
    bundledPath: '',
  })
  const [latexCheckResult, setLatexCheckResult] = useState<Array<{ name: string; path: string }> | null>(null)
  const [latexDownloading, setLatexDownloading] = useState(false)
  const [latexDownloadTaskId, setLatexDownloadTaskId] = useState<string | null>(null)
  const [latexDownloadProgress, setLatexDownloadProgress] = useState(0)

  // Word support config
  const [wordConfig, setWordConfig] = useState<{
    enabled: boolean
    sofficeType: 'system-auto' | 'system-manual' | 'bundled' | null
    sofficePath: string
    bundledPath: string
  }>({
    enabled: false,
    sofficeType: null,
    sofficePath: '',
    bundledPath: '',
  })

  // Brave Search API key
  const [braveApiKey, setBraveApiKey] = useState('')
  const [braveKeyVisible, setBraveKeyVisible] = useState(false)

  // Web & Search settings
  const [webFreeOnly, setWebFreeOnly] = useState(true)
  const [searxngEndpoint, setSearxngEndpoint] = useState('')
  const [browserHostDisabled, setBrowserHostDisabled] = useState(false)

  // Deep Research settings
  const [researchConfig, setResearchConfig] = useState<{
    enabled: boolean
    arxiv: boolean
    semanticScholar: boolean
    pubMed: boolean
    googleScholar: boolean
    googleScholarApiKey: string
    cnki: boolean
    cnkiApiKey: string
    wanfang: boolean
    wanfangApiKey: string
    webSearch: boolean
    depth: 'fast' | 'standard' | 'deep'
  }>({
    enabled: true,
    arxiv: true,
    semanticScholar: true,
    pubMed: true,
    googleScholar: false,
    googleScholarApiKey: '',
    cnki: false,
    cnkiApiKey: '',
    wanfang: false,
    wanfangApiKey: '',
    webSearch: true,
    depth: 'standard',
  })

  // Load settings
  useEffect(() => {
    if (!open) return
    async function load() {
      const [savedProviders, savedAppearance, savedDefault, savedGeneral, savedPresets, savedLatex, savedWord, savedBraveKey, savedFreeOnly, savedSearxng, savedBrowserDisabled, savedResearch] = await Promise.all([
        window.electronAPI.getSetting('llmProviders'),
        window.electronAPI.getSetting('appearanceConfig'),
        window.electronAPI.getSetting('llmDefaultConfig'),
        window.electronAPI.getSetting('generalConfig'),
        window.electronAPI.getSetting('modelPresets'),
        window.electronAPI.getSetting('latexSupport'),
        window.electronAPI.getSetting('wordSupport'),
        window.electronAPI.getSetting('braveSearchApiKey'),
        window.electronAPI.getSetting('webFreeOnly'),
        window.electronAPI.getSetting('searxngEndpoint'),
        window.electronAPI.getSetting('browserHostDisabled'),
        window.electronAPI.getSetting('researchConfig'),
      ])
      if (savedProviders) { try { setProviders(JSON.parse(savedProviders)) } catch {} }
      if (savedAppearance) { try { setAppearance(JSON.parse(savedAppearance)) } catch {} }
      if (savedDefault) { try { setDefaultConfig(JSON.parse(savedDefault)) } catch {} }
      let general: GeneralConfig = { reportEnabled: false, reportDir: '', reportStyleFile: '', reportStyleDesc: '', reportCategorizeModel: '', reportGenerateModel: '', userName: '您', agentName: 'Note Agent', userProfile: '' }
      if (savedGeneral) {
        try {
          const parsed = JSON.parse(savedGeneral)
          general = { ...general, ...parsed }
        } catch {}
      }
      if (!general.reportDir) {
        try {
          const homeDir = await window.electronAPI.getHomeDir()
          general.reportDir = `${homeDir}/report`
        } catch {}
      }
      setGeneralConfig(general)

      if (savedPresets) {
        try {
          const cfg: ModelPresetsConfig = JSON.parse(savedPresets)
          setPresets(cfg.presets || [])
          setActivePresetId(cfg.activePresetId || 'default')
        } catch {
          setPresets([{ id: 'default', name: '默认', fastModel: '', balancedModel: '', strongModel: '' }])
          setActivePresetId('default')
        }
      } else {
        setPresets([{ id: 'default', name: '默认', fastModel: '', balancedModel: '', strongModel: '' }])
        setActivePresetId('default')
      }

      if (savedLatex) {
        try {
          const parsed = JSON.parse(savedLatex)
          setLatexConfig({
            enabled: parsed.enabled ?? false,
            compilerType: parsed.compilerType ?? null,
            compilerPath: parsed.compilerPath ?? '',
            bundledPath: parsed.bundledPath ?? '',
          })
        } catch {}
      }

      if (savedWord) {
        try {
          const parsed = JSON.parse(savedWord)
          setWordConfig({
            enabled: parsed.enabled ?? false,
            sofficeType: parsed.sofficeType ?? null,
            sofficePath: parsed.sofficePath ?? '',
            bundledPath: parsed.bundledPath ?? '',
          })
        } catch {}
      }

      if (savedBraveKey) {
        setBraveApiKey(savedBraveKey)
      }
      // webFreeOnly defaults to true; the stored value 'false' explicitly turns it off
      setWebFreeOnly(savedFreeOnly !== 'false')
      if (savedSearxng) setSearxngEndpoint(savedSearxng)
      setBrowserHostDisabled(savedBrowserDisabled === 'true')
      if (savedResearch) {
        try {
          const parsed = JSON.parse(savedResearch)
          setResearchConfig((prev) => ({ ...prev, ...parsed }))
        } catch {}
      }
    }
    load()
    setExpandedProviders(new Set())
    setShowApiSetup(false)
    setShowAddPreset(false)
    setNewPresetName('')
  }, [open])

  const save = async () => {
    await window.electronAPI.setSetting('llmProviders', JSON.stringify(providers))
    await window.electronAPI.setSetting('appearanceConfig', JSON.stringify(appearance))
    await window.electronAPI.setSetting('llmDefaultConfig', JSON.stringify(defaultConfig))
    await window.electronAPI.setSetting('generalConfig', JSON.stringify(generalConfig))
    await window.electronAPI.setSetting('modelPresets', JSON.stringify({ presets, activePresetId }))
    await window.electronAPI.setSetting('latexSupport', JSON.stringify(latexConfig))
    await window.electronAPI.setSetting('wordSupport', JSON.stringify(wordConfig))
    await window.electronAPI.setSetting('braveSearchApiKey', braveApiKey.trim())
    await window.electronAPI.setSetting('webFreeOnly', webFreeOnly ? 'true' : 'false')
    await window.electronAPI.setSetting('searxngEndpoint', searxngEndpoint.trim())
    await window.electronAPI.setSetting('browserHostDisabled', browserHostDisabled ? 'true' : 'false')
    await window.electronAPI.setSetting('researchConfig', JSON.stringify(researchConfig))
    window.dispatchEvent(new CustomEvent('settings-saved'))
    onSettingsChange?.()
    onClose()
  }

  const removeProvider = async (id: string) => {
    const target = providers.find((p) => p.id === id)
    if (!target) return
    if (!confirm(t('confirmDelete', { name: target.name }))) return

    // Update local state for immediate UI feedback.
    const nextProviders = providers.filter((p) => p.id !== id)
    const nextDefault = defaultConfig.providerId === id
      ? { ...defaultConfig, providerId: '', model: '' }
      : defaultConfig
    setProviders(nextProviders)
    if (defaultConfig.providerId === id) {
      setDefaultConfig(nextDefault)
    }
    // Persist immediately so cancelling/closing the modal can't bring the
    // deleted provider back. Trash-click is treated as a committed action.
    try {
      await window.electronAPI.setSetting('llmProviders', JSON.stringify(nextProviders))
      if (defaultConfig.providerId === id) {
        await window.electronAPI.setSetting('llmDefaultConfig', JSON.stringify(nextDefault))
      }
      onSettingsChange?.()
    } catch (err) {
      console.error('[SettingsModal] failed to persist provider deletion:', err)
    }
  }

  const startRenameProvider = (id: string, currentName: string) => {
    setRenamingProviderId(id)
    setRenameValue(currentName)
  }

  const commitRenameProvider = async () => {
    const id = renamingProviderId
    if (!id) return
    const trimmed = renameValue.trim()
    setRenamingProviderId(null)
    if (!trimmed) return
    const target = providers.find((p) => p.id === id)
    if (!target || target.name === trimmed) return

    const nextProviders = providers.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
    setProviders(nextProviders)
    try {
      await window.electronAPI.setSetting('llmProviders', JSON.stringify(nextProviders))
      onSettingsChange?.()
    } catch (err) {
      console.error('[SettingsModal] failed to persist provider rename:', err)
    }
  }

  const cancelRenameProvider = () => {
    setRenamingProviderId(null)
    setRenameValue('')
  }

  const handleApiSetupComplete = (provider: ProviderConfig) => {
    setProviders((prev) => [...prev, provider])
    // If first provider, set as default
    if (providers.length === 0) {
      setDefaultConfig({
        providerId: provider.id,
        model: provider.defaultModel,
        reasoning: 'balanced',
      })
      // Initialize presets with this provider's models
      setPresets([{
        id: 'default',
        name: '默认',
        fastModel: provider.defaultModel,
        balancedModel: provider.defaultModel,
        strongModel: provider.defaultModel,
      }])
      setActivePresetId('default')
    }
    setShowApiSetup(false)
  }

  const toggleProviderExpand = (id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allModels = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })))

  const { t } = useT()

  const activePreset = presets.find((p) => p.id === activePresetId)

  const updatePresetModel = (presetId: string, tier: 'fast' | 'balanced' | 'strong', model: string) => {
    setPresets((prev) => prev.map((p) => {
      if (p.id !== presetId) return p
      return { ...p, [tier === 'fast' ? 'fastModel' : tier === 'balanced' ? 'balancedModel' : 'strongModel']: model }
    }))
  }

  const addPreset = () => {
    const name = newPresetName.trim()
    if (!name) return
    const defaultModel = defaultConfig.model || (allModels[0]?.model || '')
    const newPreset: ModelPreset = {
      id: genId(),
      name,
      fastModel: defaultModel,
      balancedModel: defaultModel,
      strongModel: defaultModel,
    }
    setPresets((prev) => [...prev, newPreset])
    setActivePresetId(newPreset.id)
    setShowAddPreset(false)
    setNewPresetName('')
  }

  const removePreset = (id: string) => {
    if (id === 'default') return
    setPresets((prev) => prev.filter((p) => p.id !== id))
    if (activePresetId === id) setActivePresetId('default')
  }

  const hasProviders = providers.length > 0

  if (!open) return null

  const leftOffset = sidebarCollapsed ? 32 : sidebarWidth

  return (
    <div className="fixed inset-0 z-[100] flex na-fade-in">
      {/* Left transparent area - sidebar shows through */}
      <div className="shrink-0" style={{ width: leftOffset, pointerEvents: 'none' }} />
      <div className="shrink-0" style={{ width: 4, pointerEvents: 'none' }} />

      {/* Settings content */}
      <div className="flex-1 flex flex-col" style={{ background: 'var(--na-bg-app)' }}>
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 px-4" style={{ height: 48, borderBottom: '1px solid var(--na-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>
              {activeTab === 'connection' && t('connection')}
              {activeTab === 'appearance' && t('appearance')}
              {activeTab === 'general' && t('general')}
              {activeTab === 'fileSupport' && t('fileSupport')}
              {activeTab === 'web' && t('web')}
              {activeTab === 'research' && t('research')}
              {activeTab === 'about' && t('about')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]"
            style={{ color: 'var(--na-text-tertiary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left navigation */}
          <div className="w-56 shrink-0 py-4 px-3 flex flex-col gap-1" style={{ background: 'var(--na-bg-sidebar)', borderRight: '1px solid var(--na-border-subtle)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider px-3 mb-3" style={{ color: 'var(--na-text-tertiary)' }}>{t('settings')}</div>
            <NavItem
              active={activeTab === 'connection'}
              onClick={() => setActiveTab('connection')}
              icon={Cable}
              label={t('connection')}
              description={t('connectionDesc')}
            />
            <NavItem
              active={activeTab === 'appearance'}
              onClick={() => setActiveTab('appearance')}
              icon={Palette}
              label={t('appearance')}
              description={t('appearanceDesc')}
            />
            <NavItem
              active={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
              icon={Settings}
              label={t('general')}
              description={t('generalDesc')}
            />
            <NavItem
              active={activeTab === 'fileSupport'}
              onClick={() => setActiveTab('fileSupport')}
              icon={FileType}
              label={t('fileSupport')}
              description={t('fileSupportDesc')}
            />
            <NavItem
              active={activeTab === 'web'}
              onClick={() => setActiveTab('web')}
              icon={Globe}
              label={t('web')}
              description={t('webDesc')}
            />
            <NavItem
              active={activeTab === 'research'}
              onClick={() => setActiveTab('research')}
              icon={FlaskConical}
              label={t('research')}
              description={t('researchDesc')}
            />
            <NavItem
              active={activeTab === 'about'}
              onClick={() => setActiveTab('about')}
              icon={Info}
              label={t('about')}
              description={t('aboutDesc')}
            />
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-auto">
            {/* ── Connection Tab ── */}
            {activeTab === 'connection' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 640 }}>
                {/* Section 1: Configured Providers */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-secondary)' }}>{t('configuredProviders')}</h3>
                  </div>
                  {providers.length === 0 && (
                    <div className="text-center py-8" style={{ borderRadius: 'var(--na-radius-lg)', border: '1px dashed var(--na-border-default)' }}>
                      <Sparkles className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--na-text-tertiary)' }} />
                      <p className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>{t('noProviders')}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('addProvider')}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {providers.map((provider) => {
                      const iconPath = getProviderIconPath(provider.id, provider.baseUrl)
                      const color = getProviderColor(provider.provider)
                      const isExpanded = expandedProviders.has(provider.id)
                      return (
                        <div key={provider.id} style={{ borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-panel)', border: '1px solid var(--na-border-subtle)' }}>
                          <div
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                            onClick={() => toggleProviderExpand(provider.id)}
                          >
                            {iconPath ? (
                              <img src={iconPath} alt="" className="w-5 h-5 shrink-0" style={{ objectFit: 'contain' }} />
                            ) : (
                              <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: color }}>
                                {provider.name.charAt(0)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {renamingProviderId === provider.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    e.stopPropagation()
                                    if (e.key === 'Enter') commitRenameProvider()
                                    else if (e.key === 'Escape') cancelRenameProvider()
                                  }}
                                  onBlur={() => commitRenameProvider()}
                                  className="w-full text-[13px] font-medium px-1.5 py-0.5 outline-none rounded"
                                  style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-accent)', color: 'var(--na-text-primary)' }}
                                />
                              ) : (
                                <div className="text-[13px] font-medium" style={{ color: 'var(--na-text-primary)' }}>{provider.name}</div>
                              )}
                              <div className="text-[10px] truncate" style={{ color: 'var(--na-text-tertiary)' }}>{provider.baseUrl}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                              ) : (
                                <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                              )}
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-4 pb-3 space-y-1" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
                              <div className="text-[10px] font-medium uppercase tracking-wider pt-2 pb-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('configuredProviders')}</div>
                              {provider.models.length === 0 && (
                                <div className="text-[11px] py-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('noProviders')}</div>
                              )}
                              {provider.models.map((m) => (
                                <div key={m} className="text-[12px] py-1 px-2 rounded" style={{ color: 'var(--na-text-secondary)' }}>
                                  {m}
                                </div>
                              ))}
                              <div className="flex items-center gap-2 pt-3 mt-1" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); startRenameProvider(provider.id, provider.name) }}
                                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors hover:bg-[var(--na-bg-hover)]"
                                  style={{ color: 'var(--na-text-secondary)' }}
                                >
                                  <Pencil className="w-3 h-3" />
                                  {t('rename')}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeProvider(provider.id) }}
                                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors hover:bg-red-50"
                                  style={{ color: '#EF4444' }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                  {t('delete')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => setShowApiSetup(true)}
                    className="flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium transition-colors w-full"
                    style={{ borderRadius: 'var(--na-radius-lg)', border: '1px dashed var(--na-accent)', color: 'var(--na-accent)' }}
                  >
                    <Plus className="w-4 h-4" />
                    {t('addProvider')}
                  </button>
                </section>

                {/* Section 2: Default Model Settings */}
                <section className="space-y-4" style={{ opacity: hasProviders ? 1 : 0.4, pointerEvents: hasProviders ? 'auto' : 'none' }}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-secondary)' }}>默认模型设置</h3>
                  <div className="p-4 space-y-4" style={{ borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-panel)', border: '1px solid var(--na-border-subtle)' }}>
                    {!hasProviders && (
                      <p className="text-[12px] text-center py-2" style={{ color: 'var(--na-text-tertiary)' }}>请先添加 AI 厂商</p>
                    )}
                    <div>
                      <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>默认模型</label>
                      <select
                        value={defaultConfig.model}
                        onChange={(e) => setDefaultConfig((c) => ({ ...c, model: e.target.value }))}
                        disabled={!hasProviders}
                        className="w-full text-[12px] px-3 py-2 outline-none rounded-lg"
                        style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-sidebar)', color: 'var(--na-text-primary)' }}
                      >
                        <option value="">选择模型</option>
                        {allModels.map(({ provider, model }) => (
                          <option key={`${provider.id}-${model}`} value={model}>{provider.name} / {model}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reasoning')}</label>
                      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-subtle)' }}>
                        {([
                          { key: 'fast' as const, label: t('fast'), desc: t('fastDesc') },
                          { key: 'balanced' as const, label: t('balanced'), desc: t('balancedDesc') },
                          { key: 'strong' as const, label: t('strong'), desc: t('strongDesc') },
                        ]).map((r) => (
                          <button
                            key={r.key}
                            onClick={() => setDefaultConfig((c) => ({ ...c, reasoning: r.key }))}
                            disabled={!hasProviders}
                            className="flex-1 py-2 text-center transition-colors rounded-md"
                            style={{
                              background: defaultConfig.reasoning === r.key ? 'var(--na-bg-active)' : 'transparent',
                            }}
                          >
                            <div className="text-[12px] font-medium" style={{ color: defaultConfig.reasoning === r.key ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)' }}>
                              {r.label}
                            </div>
                            <div className="text-[10px]" style={{ color: defaultConfig.reasoning === r.key ? 'var(--na-text-secondary)' : 'var(--na-text-tertiary)' }}>
                              {r.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section 3: Complex Task Presets */}
                <section className="space-y-4" style={{ opacity: hasProviders ? 1 : 0.4, pointerEvents: hasProviders ? 'auto' : 'none' }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-secondary)' }}>{t('complexTaskPresets')}</h3>
                  </div>
                  <div className="p-4 space-y-4" style={{ borderRadius: 'var(--na-radius-lg)', background: 'var(--na-bg-panel)', border: '1px solid var(--na-border-subtle)' }}>
                    {!hasProviders && (
                      <p className="text-[12px] text-center py-2" style={{ color: 'var(--na-text-tertiary)' }}>请先添加 AI 厂商</p>
                    )}
                    {/* Preset selector */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('preset')}</label>
                        <select
                          value={activePresetId}
                          onChange={(e) => setActivePresetId(e.target.value)}
                          disabled={!hasProviders}
                          className="w-full text-[12px] px-3 py-2 outline-none rounded-lg"
                          style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-sidebar)', color: 'var(--na-text-primary)' }}
                        >
                          {presets.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => setShowAddPreset(true)}
                        disabled={!hasProviders}
                        className="mt-5 p-2 rounded-lg transition-colors"
                        style={{ border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
                        title={t('addPreset')}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Add preset inline form */}
                    {showAddPreset && (
                      <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-subtle)' }}>
                        <input
                          type="text"
                          value={newPresetName}
                          onChange={(e) => setNewPresetName(e.target.value)}
                          placeholder={t('presetName')}
                          className="flex-1 text-[12px] px-3 py-2 outline-none rounded-lg"
                          style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                          onKeyDown={(e) => { if (e.key === 'Enter') addPreset() }}
                        />
                        <button onClick={addPreset} className="px-3 py-2 text-[11px] rounded-lg" style={{ background: 'var(--na-accent)', color: '#fff' }}>{t('add')}</button>
                        <button onClick={() => { setShowAddPreset(false); setNewPresetName('') }} className="px-3 py-2 text-[11px] rounded-lg" style={{ border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}>{t('cancel')}</button>
                      </div>
                    )}

                    {/* Tier model selectors */}
                    {activePreset && (
                      <div className="space-y-3">
                        {([
                          { key: 'fast' as const, label: t('fast'), color: '#22C55E', field: 'fastModel' as const },
                          { key: 'balanced' as const, label: t('balanced'), color: '#EAB308', field: 'balancedModel' as const },
                          { key: 'strong' as const, label: t('strong'), color: '#EF4444', field: 'strongModel' as const },
                        ]).map((tier) => (
                          <div key={tier.key} className="flex items-center gap-3">
                            <span className="text-[12px] font-medium w-16 shrink-0 flex items-center gap-1.5" style={{ color: 'var(--na-text-secondary)' }}>
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tier.color }} />
                              {tier.label}
                            </span>
                            <select
                              value={activePreset[tier.field]}
                              onChange={(e) => updatePresetModel(activePreset.id, tier.key, e.target.value)}
                              disabled={!hasProviders}
                              className="flex-1 text-[12px] px-3 py-2 outline-none rounded-lg"
                              style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-sidebar)', color: 'var(--na-text-primary)' }}
                            >
                              <option value="">选择模型</option>
                              {allModels.map(({ provider, model }) => (
                                <option key={`${provider.id}-${model}`} value={model}>{provider.name} / {model}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Remove preset */}
                    {activePresetId !== 'default' && (
                      <button
                        onClick={() => removePreset(activePresetId)}
                        className="text-[11px] px-3 py-1.5 rounded-lg transition-colors"
                        style={{ color: '#EF4444' }}
                      >
                        {t('removePreset')}
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
            {/* ── Appearance Tab ── */}
            {activeTab === 'appearance' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 720 }}>
                {/* Scale */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ZoomIn className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('scale')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('scale')}</p>
                  <div className="flex items-center gap-4">
                    <input type="range" min={80} max={150} step={5} value={Math.round((appearance.scale || 1) * 100)} onChange={(e) => setAppearance((a) => ({ ...a, scale: parseInt(e.target.value) / 100 }))} className="flex-1" />
                    <span className="text-[13px] font-medium w-16 text-right" style={{ color: 'var(--na-text-primary)' }}>{Math.round((appearance.scale || 1) * 100)}%</span>
                  </div>
                </section>

                {/* Theme */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('theme')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('theme')}</p>
                  <div className="flex gap-2">
                    {(['light', 'dark', 'system'] as const).map((themeOpt) => (
                      <button
                        key={themeOpt}
                        onClick={() => setAppearance((a) => ({ ...a, theme: themeOpt }))}
                        className="flex-1 py-2.5 text-[13px] text-center transition-colors"
                        style={{
                          borderRadius: 'var(--na-radius-md)',
                          border: `1px solid ${appearance.theme === themeOpt ? 'var(--na-accent)' : 'var(--na-border-default)'}`,
                          background: appearance.theme === themeOpt ? 'var(--na-bg-active)' : 'transparent',
                          color: appearance.theme === themeOpt ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                        }}
                      >
                        {themeOpt === 'light' ? t('light') : themeOpt === 'dark' ? t('dark') : t('system')}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Language */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('language')}</h3>
                  </div>
                  <div className="flex gap-2">
                    {([
                      { key: 'zh' as const, label: '简体中文' },
                      { key: 'en' as const, label: 'English' },
                      { key: 'ja' as const, label: '日本語' },
                    ]).map((l) => (
                      <button
                        key={l.key}
                        onClick={() => setAppearance((a) => ({ ...a, lang: l.key }))}
                        className="flex-1 py-2.5 text-[13px] text-center transition-colors"
                        style={{
                          borderRadius: 'var(--na-radius-md)',
                          border: `1px solid ${appearance.lang === l.key ? 'var(--na-accent)' : 'var(--na-border-default)'}`,
                          background: appearance.lang === l.key ? 'var(--na-bg-active)' : 'transparent',
                          color: appearance.lang === l.key ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                        }}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </section>

                {/* UI Font */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('uiFont')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('uiFont')}</p>
                  <select
                    value={appearance.uiFont}
                    onChange={(e) => setAppearance((a) => ({ ...a, uiFont: e.target.value }))}
                    className="w-full text-[13px] px-3 py-2.5 outline-none"
                    style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  >
                    <option value="system">System Default</option>
                    <option value="inter">Inter</option>
                    <option value="sf-pro">SF Pro</option>
                  </select>
                </section>

                {/* Editor Font */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('editorFont')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('editorFont')}</p>
                  <select
                    value={appearance.editorFont}
                    onChange={(e) => setAppearance((a) => ({ ...a, editorFont: e.target.value }))}
                    className="w-full text-[13px] px-3 py-2.5 outline-none"
                    style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  >
                    <option value="jetbrains-mono">JetBrains Mono</option>
                    <option value="sf-mono">SF Mono</option>
                    <option value="fira-code">Fira Code</option>
                    <option value="monospace">System Mono</option>
                  </select>
                </section>

                {/* Editor Font Size */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ZoomIn className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('editorFontSize')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('editorFontSize')}</p>
                  <div className="flex items-center gap-4">
                    <input type="range" min={10} max={24} step={1} value={appearance.editorFontSize} onChange={(e) => setAppearance((a) => ({ ...a, editorFontSize: parseInt(e.target.value) }))} className="flex-1" />
                    <span className="text-[13px] font-medium w-16 text-right" style={{ color: 'var(--na-text-primary)' }}>{appearance.editorFontSize}px</span>
                  </div>
                </section>
              </div>
            )}

            {/* ── General Tab ── */}
            {activeTab === 'fileSupport' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 720 }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-secondary)' }}>文件类型支持</h3>
                </div>
                <LaTeXSupportCard
                  config={latexConfig}
                  onChange={(cfg) => {
                    setLatexConfig(cfg)
                    window.electronAPI.setSetting('latexSupport', JSON.stringify(cfg))
                  }}
                />
                <WordSupportCard
                  config={wordConfig}
                  onChange={(cfg) => {
                    setWordConfig(cfg)
                    window.electronAPI.setSetting('wordSupport', JSON.stringify(cfg))
                  }}
                />
              </div>
            )}

            {activeTab === 'general' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 720 }}>
                {/* Report Generation Toggle */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('reportEnabled')}</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('reportEnabled')}</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setGeneralConfig((g) => ({ ...g, reportEnabled: !g.reportEnabled }))}
                      className="relative w-10 h-5 rounded-full transition-colors"
                      style={{
                        background: generalConfig.reportEnabled ? 'var(--na-accent)' : 'var(--na-border-default)',
                      }}
                    >
                      <div
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                        style={{
                          left: generalConfig.reportEnabled ? 'calc(100% - 1.125rem)' : '0.125rem',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                        }}
                      />
                    </button>
                    <span className="text-[13px]" style={{ color: 'var(--na-text-secondary)' }}>
                      {generalConfig.reportEnabled ? t('enabled') : t('disabled')}
                    </span>
                  </div>
                </section>

                {/* Report Config */}
                <section className="space-y-5 transition-opacity" style={{ opacity: generalConfig.reportEnabled ? 1 : 0.4, pointerEvents: generalConfig.reportEnabled ? 'auto' : 'none' }}>
                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reportDir')}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={generalConfig.reportDir}
                        onChange={(e) => setGeneralConfig((g) => ({ ...g, reportDir: e.target.value }))}
                        className="flex-1 text-[12px] px-3 py-2 outline-none"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder={t('reportDir')}
                      />
                      <button
                        onClick={async () => {
                          const result = await window.electronAPI.openDirectory()
                          if (!result.canceled && result.path) setGeneralConfig((g) => ({ ...g, reportDir: result.path! }))
                        }}
                        className="flex items-center gap-1 px-3 py-2 text-[11px] transition-colors"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        {t('browse')}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reportStyleFile')}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={generalConfig.reportStyleFile}
                        onChange={(e) => setGeneralConfig((g) => ({ ...g, reportStyleFile: e.target.value }))}
                        className="flex-1 text-[12px] px-3 py-2 outline-none"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder={t('reportStyleFile')}
                      />
                      <button
                        onClick={async () => {
                          const result = await window.electronAPI.openFile({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
                          if (!result.canceled && result.paths.length > 0) setGeneralConfig((g) => ({ ...g, reportStyleFile: result.paths[0] }))
                        }}
                        className="flex items-center gap-1 px-3 py-2 text-[11px] transition-colors"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {t('select')}
                      </button>
                      {generalConfig.reportStyleFile && (
                        <button
                          onClick={() => setGeneralConfig((g) => ({ ...g, reportStyleFile: '' }))}
                          className="px-3 py-2 text-[11px] transition-colors"
                          style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', color: '#EF4444' }}
                        >
                          {t('clear')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reportStyleDesc')}</label>
                    <textarea
                      value={generalConfig.reportStyleDesc}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, reportStyleDesc: e.target.value }))}
                      rows={4}
                      className="w-full text-[12px] px-3 py-2 outline-none resize-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                      placeholder={t('reportStylePlaceholder')}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reportCategorizeModel')}</label>
                    <select
                      value={generalConfig.reportCategorizeModel || ''}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, reportCategorizeModel: e.target.value || undefined }))}
                      className="w-full text-[12px] px-3 py-2 outline-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                    >
                      <option value="">{t('useDefaultModel')}</option>
                      {providers.flatMap((p) => p.models.map((m) => (
                        <option key={`${p.id}-${m}`} value={m}>{p.name} / {m}</option>
                      )))}
                    </select>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('categorizeModelHint')}</p>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('reportGenerateModel')}</label>
                    <select
                      value={generalConfig.reportGenerateModel || ''}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, reportGenerateModel: e.target.value || undefined }))}
                      className="w-full text-[12px] px-3 py-2 outline-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                    >
                      <option value="">{t('selectModel')}</option>
                      {providers.flatMap((p) => p.models.map((m) => (
                        <option key={`${p.id}-${m}`} value={m}>{p.name} / {m}</option>
                      )))}
                    </select>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('generateModelHint')}</p>
                  </div>
                </section>

                {/* Personalization */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('personalization')}</h3>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('userName')}</label>
                    <input
                      type="text"
                      value={generalConfig.userName}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, userName: e.target.value }))}
                      className="w-full text-[12px] px-3 py-2 outline-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                      placeholder={t('userName')}
                    />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('userName')}</p>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('agentName')}</label>
                    <input
                      type="text"
                      value={generalConfig.agentName}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, agentName: e.target.value }))}
                      className="w-full text-[12px] px-3 py-2 outline-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                      placeholder="Note Agent"
                    />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('agentName')}</p>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('userProfile')}</label>
                    <textarea
                      value={generalConfig.userProfile}
                      onChange={(e) => setGeneralConfig((g) => ({ ...g, userProfile: e.target.value }))}
                      rows={3}
                      className="w-full text-[12px] px-3 py-2 outline-none resize-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                      placeholder={t('userProfilePlaceholder')}
                    />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('userProfile')}</p>
                  </div>
                </section>

                {/* Shell Environment (Windows only) */}
                <ShellEnvSettings />

              </div>
            )}

            {/* ── Web & Search Tab ── */}
            {activeTab === 'web' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 720 }}>
                {/* Browser tool */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>浏览器工具</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    隐藏的 Chromium 标签页，让 Agent 能直接渲染搜索引擎和反爬页面。这是 webSearch 的默认路径，也支持 browse 工具的多步交互。关闭后，搜索将退化到 HTML 抓取（在 2026 年大多数情况下不可靠）。
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setBrowserHostDisabled((v) => !v)}
                      className="relative w-10 h-5 rounded-full transition-colors"
                      style={{
                        background: !browserHostDisabled ? 'var(--na-accent)' : 'var(--na-border-default)',
                      }}
                    >
                      <div
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                        style={{ transform: !browserHostDisabled ? 'translateX(20px)' : 'translateX(2px)' }}
                      />
                    </button>
                    <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>
                      {!browserHostDisabled ? '已启用' : '已禁用'}
                    </span>
                  </div>
                </section>

                {/* Free-only mode */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>仅使用免费搜索</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    开启时跳过所有付费 API（如 Brave Search），仅使用浏览器工具、Wikipedia、HN Algolia 等免费来源。关闭后，已配置的付费 API 会优先使用。
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setWebFreeOnly((v) => !v)}
                      className="relative w-10 h-5 rounded-full transition-colors"
                      style={{
                        background: webFreeOnly ? 'var(--na-accent)' : 'var(--na-border-default)',
                      }}
                    >
                      <div
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                        style={{ transform: webFreeOnly ? 'translateX(20px)' : 'translateX(2px)' }}
                      />
                    </button>
                    <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>
                      {webFreeOnly ? '仅免费' : '允许付费 API'}
                    </span>
                  </div>
                </section>

                {/* Brave Search API Key */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>Brave Search API</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    配置后会作为最高优先级（需关闭"仅免费"模式）。Brave 提供每月 2000 次免费查询。在 api.search.brave.com 注册即可获得 API Key。
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type={braveKeyVisible ? 'text' : 'password'}
                      value={braveApiKey}
                      onChange={(e) => setBraveApiKey(e.target.value)}
                      className="flex-1 text-[12px] px-3 py-2 outline-none"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                      placeholder="BSAt..."
                    />
                    <button
                      onClick={() => setBraveKeyVisible((v) => !v)}
                      className="px-3 py-2 text-[11px] transition-colors"
                      style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', color: 'var(--na-text-secondary)' }}
                    >
                      {braveKeyVisible ? '隐藏' : '显示'}
                    </button>
                  </div>
                </section>

                {/* SearXNG endpoint */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cable className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>SearXNG 自托管实例</h3>
                  </div>
                  <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    可选。若你运行了私有 SearXNG（或信任某个公共实例），填入完整 URL 即可作为搜索后端。公共实例普遍限流严重，因此默认不预填。
                  </p>
                  <input
                    type="text"
                    value={searxngEndpoint}
                    onChange={(e) => setSearxngEndpoint(e.target.value)}
                    className="w-full text-[12px] px-3 py-2 outline-none"
                    style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                    placeholder="https://searx.example.com"
                  />
                </section>

                {/* Routing summary */}
                <section className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--na-text-secondary)' }}>路由顺序</h4>
                  <div className="text-[11px] space-y-1" style={{ color: 'var(--na-text-tertiary)' }}>
                    <div>1. 强匹配 → Wikipedia / HN Algolia（命中即返回）</div>
                    <div>2. 默认 → 浏览器工具（DDG → Bing 渲染）</div>
                    <div>3. 浏览器不可用 → Brave / SearXNG / DDG HTML / Bing HTML 级联</div>
                  </div>
                </section>
              </div>
            )}

            {/* ── Research Tab ── */}
            {activeTab === 'research' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 640 }}>
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
                    <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>深度研究模式</h3>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={researchConfig.enabled}
                      onChange={(e) => setResearchConfig((c) => ({ ...c, enabled: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>启用深度研究模式</span>
                  </label>
                </section>

                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>学术数据源（免费）</h3>
                  <div className="space-y-2">
                    {[
                      { key: 'arxiv', label: 'arXiv（物理学、数学、计算机科学）' },
                      { key: 'semanticScholar', label: 'Semantic Scholar（全学科覆盖）' },
                      { key: 'pubMed', label: 'PubMed / Europe PMC（生物医学）' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(researchConfig as any)[key]}
                          onChange={(e) => setResearchConfig((c) => ({ ...c, [key]: e.target.checked }))}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>{label}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>付费数据源（需 API Key）</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={researchConfig.googleScholar}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, googleScholar: e.target.checked }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>Google Scholar（SerpApi）</span>
                    </label>
                    {researchConfig.googleScholar && (
                      <input
                        type="text"
                        value={researchConfig.googleScholarApiKey}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, googleScholarApiKey: e.target.value }))}
                        className="w-full text-[12px] px-3 py-2 outline-none"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder="SerpApi API Key"
                      />
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={researchConfig.cnki}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, cnki: e.target.checked }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>CNKI 中国知网</span>
                    </label>
                    {researchConfig.cnki && (
                      <input
                        type="text"
                        value={researchConfig.cnkiApiKey}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, cnkiApiKey: e.target.value }))}
                        className="w-full text-[12px] px-3 py-2 outline-none"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder="CNKI API Key"
                      />
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={researchConfig.wanfang}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, wanfang: e.target.checked }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>万方数据</span>
                    </label>
                    {researchConfig.wanfang && (
                      <input
                        type="text"
                        value={researchConfig.wanfangApiKey}
                        onChange={(e) => setResearchConfig((c) => ({ ...c, wanfangApiKey: e.target.value }))}
                        className="w-full text-[12px] px-3 py-2 outline-none"
                        style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder="万方 API Key"
                      />
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>通用搜索</h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={researchConfig.webSearch}
                      onChange={(e) => setResearchConfig((c) => ({ ...c, webSearch: e.target.checked }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-[12px]" style={{ color: 'var(--na-text-secondary)' }}>启用网络搜索（使用现有 webSearch / webFetch 工具）</span>
                  </label>
                </section>

                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>研究深度</h3>
                  <div className="flex gap-2">
                    {([
                      { key: 'fast', label: '快速', desc: '3 步' },
                      { key: 'standard', label: '标准', desc: '6 步' },
                      { key: 'deep', label: '深度', desc: '8 步 + 批判验证' },
                    ] as const).map(({ key, label, desc }) => (
                      <button
                        key={key}
                        onClick={() => setResearchConfig((c) => ({ ...c, depth: key }))}
                        className="flex-1 px-3 py-2 text-[12px] rounded-lg transition-colors text-left"
                        style={{
                          border: '1px solid var(--na-border-default)',
                          background: researchConfig.depth === key ? 'var(--na-bg-active)' : 'var(--na-bg-panel)',
                          color: researchConfig.depth === key ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                        }}
                      >
                        <div className="font-medium">{label}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* ── About Tab ── */}
            {activeTab === 'about' && (
              <div className="h-full px-8 py-8 space-y-8" style={{ maxWidth: 640 }}>
                <section className="flex flex-col items-center text-center space-y-4">
                  <img src="./assets/icon.png" alt="Note Agent" className="w-20 h-20 rounded-2xl" style={{ objectFit: 'cover' }} />
                  <div>
                    <h3 className="text-[18px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>Note Agent</h3>
                    <p className="text-[13px] mt-1" style={{ color: 'var(--na-text-secondary)' }}>Local-first, task-session driven desktop agent workspace</p>
                  </div>
                  <div className="space-y-1 text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
                    <p>{t('version')} v0.1.0</p>
                    <p>{t('author')} 老鸡软糖</p>
                  </div>
                  <div className="p-3 rounded-lg text-left w-full" style={{ background: 'var(--na-bg-active)', border: '1px solid var(--na-border-subtle)' }}>
                    <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--na-text-secondary)' }}>{t('license')}</div>
                    <p className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('licenseText')}</p>
                    <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener noreferrer" className="text-[11px] mt-1 inline-block hover:underline" style={{ color: 'var(--na-accent)' }}>Apache License 2.0 →</a>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>

        {/* Footer save bar */}
        <div className="shrink-0 flex items-center justify-end px-6 py-3 gap-3" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] rounded-lg transition-colors"
            style={{ color: 'var(--na-text-secondary)' }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            className="px-5 py-1.5 text-[12px] rounded-lg font-medium transition-colors"
            style={{ background: 'var(--na-accent)', color: '#fff' }}
          >
            {t('save')}
          </button>
        </div>
      </div>

      {/* ApiSetupModal */}
      <ApiSetupModal
        open={showApiSetup}
        existingProviders={providers}
        onClose={() => setShowApiSetup(false)}
        onComplete={handleApiSetupComplete}
      />
    </div>
  )
}

function NavItem({ active, onClick, icon: Icon, label, description }: { active: boolean; onClick: () => void; icon: typeof Cable; label: string; description: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 transition-colors rounded-lg flex items-start gap-3"
      style={{
        color: active ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
        background: active ? 'var(--na-bg-active)' : 'transparent',
      }}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: active ? 'var(--na-accent)' : 'var(--na-text-tertiary)' }} />
      <div>
        <div className="text-[13px] font-medium" style={{ color: active ? 'var(--na-text-primary)' : 'var(--na-text-secondary)' }}>{label}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>{description}</div>
      </div>
    </button>
  )
}

function genId(): string {
  return crypto.randomUUID()
}


// ── Shell Environment Settings (Windows only) ──
function ShellEnvSettings() {
  const [platform, setPlatform] = useState('')
  const [shellEnv, setShellEnv] = useState<{ type: 'gitbash' | 'wsl' | 'native'; path?: string } | null>(null)
  const [detected, setDetected] = useState<{ gitbash?: string; wsl: boolean }>({ wsl: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const plat = await window.electronAPI.getPlatform()
      setPlatform(plat)
      if (plat === 'win32') {
        const cfg = await window.electronAPI.shellEnvGet()
        setShellEnv(cfg)
        const d = await window.electronAPI.shellEnvDetect()
        setDetected(d)
      }
      setLoading(false)
    })()
  }, [])

  const handleChange = async (type: 'gitbash' | 'wsl' | 'native') => {
    const path = type === 'gitbash' ? (detected.gitbash || '') : undefined
    const cfg = { type, path }
    await window.electronAPI.shellEnvSet(cfg)
    setShellEnv(cfg)
    toast.success('命令执行环境已更新')
  }

  if (platform !== 'win32') return null
  if (loading) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4" style={{ color: 'var(--na-text-secondary)' }} />
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>命令执行环境</h3>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--na-text-tertiary)' }}>
        选择 AI 执行命令时使用的 Shell 环境。Git Bash 或 WSL 可获得最佳兼容性。
      </p>
      <div className="space-y-2">
        {([
          { key: 'gitbash' as const, label: 'Git Bash', desc: detected.gitbash ? `已检测到: ${detected.gitbash}` : '未检测到，请手动安装 Git for Windows' },
          { key: 'wsl' as const, label: 'WSL', desc: detected.wsl ? '已安装' : '未安装，请运行 wsl --install' },
          { key: 'native' as const, label: '原生 cmd / PowerShell', desc: '无需安装，但部分 bash 命令不兼容' },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleChange(opt.key)}
            className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all"
            style={{
              border: shellEnv?.type === opt.key ? '2px solid var(--na-accent)' : '1px solid var(--na-border-subtle)',
              background: shellEnv?.type === opt.key ? 'var(--na-bg-active)' : 'transparent',
            }}
          >
            <div
              className="w-4 h-4 rounded-full shrink-0 border-2 flex items-center justify-center"
              style={{ borderColor: shellEnv?.type === opt.key ? 'var(--na-accent)' : 'var(--na-border-default)' }}
            >
              {shellEnv?.type === opt.key && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--na-accent)' }} />}
            </div>
            <div>
              <div className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>{opt.label}</div>
              <div className="text-[10px]" style={{ color: 'var(--na-text-tertiary)' }}>{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
