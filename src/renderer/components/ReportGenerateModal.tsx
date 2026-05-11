import { useState, useEffect, useRef } from 'react'
import { X, Loader2, FileText, ChevronRight, ChevronLeft, Check, Plus, Trash2, FilePlus } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../hooks/useT'

interface ReportGenerateModalProps {
  open: boolean
  onClose: () => void
  workspacePath: string
  tasks: Array<{ id: string; title: string }>
}

interface GeneralConfig {
  reportEnabled: boolean
  reportDir: string
  reportStyleFile: string
  reportStyleDesc: string
  reportGenerateModel?: string
  reportCategorizeModel?: string
}

interface SourceItem {
  id: string
  type: 'task' | 'description' | 'file'
  title: string
  content?: string
  selected: boolean
}

export default function ReportGenerateModal({ open, onClose, workspacePath, tasks }: ReportGenerateModalProps) {
  const { t } = useT()
  const STEPS = [t('selectSources'), t('selectTemplate'), t('generateReport')]
  const [step, setStep] = useState(0)
  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    reportEnabled: false, reportDir: '', reportStyleFile: '', reportStyleDesc: '',
  })

  // Step 0: Sources
  const [sources, setSources] = useState<SourceItem[]>([])
  const [globalDesc, setGlobalDesc] = useState('')
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')

  // Step 1: Template
  const [templateMode, setTemplateMode] = useState<'default' | 'styleFile' | 'custom'>('default')
  const [customTemplate, setCustomTemplate] = useState('')
  const [generateModel, setGenerateModel] = useState('')
  const [categorizeModel, setCategorizeModel] = useState('')

  // Step 2: Generate
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState('')
  const [generatedFile, setGeneratedFile] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  // Providers for model selection
  const [providers, setProviders] = useState<any[]>([])

  const allModels = providers.flatMap((p) => p.models.map((m: string) => ({ provider: p, model: m })))

  useEffect(() => {
    if (!open) return
    async function load() {
      const [saved, providersStr] = await Promise.all([
        window.electronAPI.getSetting('generalConfig'),
        window.electronAPI.getSetting('llmProviders'),
      ])
      let cfg: GeneralConfig = { reportEnabled: false, reportDir: '', reportStyleFile: '', reportStyleDesc: '' }
      if (saved) { try { cfg = JSON.parse(saved) } catch {} }
      setGeneralConfig(cfg)

      if (providersStr) {
        try { setProviders(JSON.parse(providersStr)) } catch {}
      }

      // Build sources from tasks
      const taskSources: SourceItem[] = tasks.map((t) => ({
        id: `task:${t.id}`,
        type: 'task',
        title: t.title,
        selected: true,
      }))
      setSources(taskSources)
      setGlobalDesc('')
      setTimeStart('')
      setTimeEnd('')
      setStep(0)
      setTemplateMode('default')
      setCustomTemplate('')
      setGeneratedContent('')
      setGeneratedFile('')
      setGenerateModel(cfg.reportGenerateModel || '')
      setCategorizeModel(cfg.reportCategorizeModel || '')
    }
    load()
  }, [open, tasks])

  // Auto-scroll during generation
  useEffect(() => {
    if (step === 2 && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [step, generatedContent])

  const selectedSources = sources.filter((s) => s.selected)

  const canProceed = () => {
    if (step === 0) return selectedSources.length > 0
    if (step === 1) {
      if (templateMode === 'custom') return customTemplate.trim().length > 0
      return true
    }
    return true
  }

  const loadSourceContents = async () => {
    const taskSources = selectedSources.filter((s) => s.type === 'task')
    const taskIds = taskSources.map((s) => s.id.replace('task:', ''))
    let allMessages: any[] = []
    if (taskIds.length > 0) {
      const startUnix = timeStart ? Math.floor(new Date(timeStart).getTime() / 1000) : undefined
      const endUnix = timeEnd ? Math.floor(new Date(timeEnd + 'T23:59:59').getTime() / 1000) : undefined
      allMessages = await window.electronAPI.getReportMessages(taskIds, startUnix, endUnix)
    }

    const contents = new Map<string, string>()
    for (const s of selectedSources) {
      if (s.type === 'task') {
        const taskId = s.id.replace('task:', '')
        const taskMessages = allMessages.filter((m) => m.task_id === taskId)
        if (taskMessages.length > 0) {
          const text = taskMessages.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n\n')
          contents.set(s.id, text.slice(0, 3000))
        } else {
          contents.set(s.id, `【任务标题】${s.title}（暂无详细对话记录）`)
        }
      } else if (s.type === 'description') {
        contents.set(s.id, s.content || '')
      } else if (s.type === 'file') {
        try {
          const res = await window.electronAPI.readFile(s.content || '')
          contents.set(s.id, res.error ? '' : res.content.slice(0, 3000))
        } catch {
          contents.set(s.id, '')
        }
      }
    }
    return contents
  }

  const resolveConfig = (modelName: string): any => {
    const active = providers.find((p) => p.models?.includes(modelName))
    if (active) {
      return { provider: active.provider, model: modelName, apiKey: active.apiKey, baseUrl: active.baseUrl, providerName: active.name || active.provider }
    }
    // Fallback to first available provider
    const first = providers.find((p) => p.apiKey && p.models?.length > 0)
    if (first) {
      return { provider: first.provider, model: first.defaultModel || first.models[0], apiKey: first.apiKey, baseUrl: first.baseUrl, providerName: first.name || first.provider }
    }
    return null
  }

  const handleGenerate = async () => {
    if (!canProceed()) return
    if (!generalConfig.reportDir) { toast.error('请先在设置中配置报告保存目录'); return }

    setIsGenerating(true)
    setGeneratedContent('')
    setGeneratedFile('')
    setStep(2)

    try {
      const contents = await loadSourceContents()

      let templateContent: string | undefined
      if (templateMode === 'styleFile' && generalConfig.reportStyleFile) {
        try {
          const res = await window.electronAPI.readFile(generalConfig.reportStyleFile)
          if (!res.error) templateContent = res.content
        } catch {}
      } else if (templateMode === 'custom') {
        templateContent = customTemplate
      }

      let config = resolveConfig(generateModel)
      if (!config) { toast.error('请先配置 AI 连接'); setIsGenerating(false); setStep(1); return }

      let categorizeConfig = categorizeModel ? resolveConfig(categorizeModel) : undefined

      const apiSources = selectedSources.map((s) => ({
        type: s.type,
        id: s.id,
        title: s.title,
        content: contents.get(s.id) || '',
      }))

      const result = await window.electronAPI.generateReportStream({
        config,
        categorizeConfig,
        sources: apiSources,
        globalDescription: globalDesc || undefined,
        templateContent,
        reportDir: generalConfig.reportDir,
        workspacePath,
        timeRange: timeStart || timeEnd ? { start: timeStart || undefined, end: timeEnd || undefined } : undefined,
      })

      setGeneratedContent(result.content)
      setGeneratedFile(result.fileName)
      toast.success(`报告已生成: ${result.fileName}`)
    } catch (e: any) {
      toast.error('生成失败: ' + e.message)
      setStep(1)
    } finally {
      setIsGenerating(false)
    }
  }

  const addDescriptionSource = () => {
    const id = `desc:${Date.now()}`
    setSources((prev) => [...prev, { id, type: 'description', title: '补充描述', content: '', selected: true }])
  }

  const addFileSource = async () => {
    const result = await window.electronAPI.openFile({ multiple: true })
    if (result.canceled) return
    const newSources: SourceItem[] = result.paths.map((p: string) => ({
      id: `file:${p}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      type: 'file',
      title: p.split(/[\\/]/).pop() || p,
      content: p,
      selected: true,
    }))
    setSources((prev) => [...prev, ...newSources])
  }

  const updateSourceContent = (id: string, content: string) => {
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, content } : s))
  }

  const updateSourceTitle = (id: string, title: string) => {
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, title } : s))
  }

  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  const toggleSourceSelected = (id: string) => {
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, selected: !s.selected } : s))
  }

  const getModelDisplay = (modelName: string) => {
    if (!modelName) return '使用默认模型'
    const entry = allModels.find((m) => m.model === modelName)
    if (entry) return `${entry.provider.name} / ${modelName}`
    return modelName
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center na-fade-in" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-[640px] max-h-[85vh] flex flex-col overflow-hidden" style={{ borderRadius: 'var(--na-radius-xl)', background: 'var(--na-bg-panel)', boxShadow: 'var(--na-shadow-lg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 px-5" style={{ height: 48, borderBottom: '1px solid var(--na-border-subtle)' }}>
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{t('generateReport')}</h2>
            <div className="flex items-center gap-1">
              {STEPS.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium ${
                    i < step ? 'bg-green-500 text-white' : i === step ? 'bg-[var(--na-accent)] text-white' : 'bg-[var(--na-bg-hover)] text-[var(--na-text-tertiary)]'
                  }`}>
                    {i < step ? <Check className="w-3 h-3" /> : i + 1}
                  </div>
                  <span className={`text-[10px] ${i === step ? 'font-medium' : ''}`} style={{ color: i === step ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)' }}>{s}</span>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3" style={{ color: 'var(--na-text-tertiary)' }} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* Step 0: Select Sources */}
          {step === 0 && (
            <>
              {/* Tasks */}
              <div>
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('selectTasks')}</label>
                <div className="space-y-1 max-h-40 overflow-auto" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', padding: '6px 8px' }}>
                  {tasks.length === 0 && <div className="text-[11px] py-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('noTasks')}</div>}
                  {tasks.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sources.find((s) => s.id === `task:${t.id}`)?.selected ?? true}
                        onChange={(e) => {
                          setSources((prev) => prev.map((s) => s.id === `task:${t.id}` ? { ...s, selected: e.target.checked } : s))
                        }}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <span className="text-[12px] truncate" style={{ color: 'var(--na-text-primary)' }}>{t.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Time range */}
              <div>
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('timeRange')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={timeStart}
                    onChange={(e) => setTimeStart(e.target.value)}
                    className="flex-1 text-[12px] px-3 py-2 outline-none"
                    style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>至</span>
                  <input
                    type="date"
                    value={timeEnd}
                    onChange={(e) => setTimeEnd(e.target.value)}
                    className="flex-1 text-[12px] px-3 py-2 outline-none"
                    style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  />
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('timeRangeHint')}</p>
              </div>

              {/* File sources */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>{t('fileMaterials')}</label>
                  <button onClick={addFileSource} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors" style={{ color: 'var(--na-accent)', border: '1px solid var(--na-border-subtle)' }}>
                    <FilePlus className="w-3 h-3" /> {t('addFile')}
                  </button>
                </div>
                <div className="space-y-1">
                  {sources.filter((s) => s.type === 'file').map((s) => (
                    <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-active)' }}>
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() => toggleSourceSelected(s.id)}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
                      <span className="text-[11px] truncate flex-1" style={{ color: 'var(--na-text-primary)' }}>{s.title}</span>
                      <button onClick={() => removeSource(s.id)} className="p-1 rounded hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {sources.filter((s) => s.type === 'file').length === 0 && (
                    <div className="text-[11px] py-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('noFilesAdded')}</div>
                  )}
                </div>
              </div>

              {/* Description sources */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>{t('supplementalDesc')}</label>
                  <button onClick={addDescriptionSource} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors" style={{ color: 'var(--na-accent)', border: '1px solid var(--na-border-subtle)' }}>
                    <Plus className="w-3 h-3" /> {t('addDesc')}
                  </button>
                </div>
                <div className="space-y-2">
                  {sources.filter((s) => s.type === 'description').map((s) => (
                    <div key={s.id} className="space-y-1 p-2" style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-active)' }}>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={s.title}
                          onChange={(e) => updateSourceTitle(s.id, e.target.value)}
                          className="flex-1 text-[11px] px-2 py-1 outline-none rounded"
                          style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                          placeholder="描述标题"
                        />
                        <button onClick={() => removeSource(s.id)} className="p-1 rounded hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <textarea
                        value={s.content}
                        onChange={(e) => updateSourceContent(s.id, e.target.value)}
                        rows={3}
                        className="w-full text-[11px] px-2 py-1.5 outline-none rounded resize-none"
                        style={{ border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                        placeholder="输入补充描述..."
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Global description */}
              <div>
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('globalDesc')}</label>
                <textarea
                  value={globalDesc}
                  onChange={(e) => setGlobalDesc(e.target.value)}
                  rows={3}
                  className="w-full text-[12px] px-3 py-2 outline-none rounded resize-none"
                  style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                  placeholder={t('globalDescPlaceholder')}
                />
              </div>
            </>
          )}

          {/* Step 1: Template */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="template" checked={templateMode === 'default'} onChange={() => setTemplateMode('default')} className="w-3.5 h-3.5" />
                  <span className="text-[12px]" style={{ color: 'var(--na-text-primary)' }}>{t('defaultTemplate')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="template" checked={templateMode === 'styleFile'} onChange={() => setTemplateMode('styleFile')} className="w-3.5 h-3.5" />
                  <span className="text-[12px]" style={{ color: 'var(--na-text-primary)' }}>{t('styleFile')}</span>
                </label>
                {templateMode === 'styleFile' && (
                  <div className="ml-5 p-2 rounded" style={{ background: 'var(--na-bg-active)', border: '1px solid var(--na-border-subtle)' }}>
                    {generalConfig.reportStyleFile ? (
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5" style={{ color: 'var(--na-text-tertiary)' }} />
                        <span className="text-[11px]" style={{ color: 'var(--na-text-primary)' }}>{generalConfig.reportStyleFile.split(/[\\/]/).pop()}</span>
                      </div>
                    ) : (
                      <div className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>{t('noStyleFile')}</div>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="template" checked={templateMode === 'custom'} onChange={() => setTemplateMode('custom')} className="w-3.5 h-3.5" />
                  <span className="text-[12px]" style={{ color: 'var(--na-text-primary)' }}>{t('customTemplate')}</span>
                </label>
                {templateMode === 'custom' && (
                  <textarea
                    value={customTemplate}
                    onChange={(e) => setCustomTemplate(e.target.value)}
                    rows={8}
                    className="w-full text-[11px] px-3 py-2 outline-none rounded resize-none ml-5"
                    style={{ width: 'calc(100% - 20px)', borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                    placeholder={t('customTemplatePlaceholder')}
                  />
                )}
              </div>

              {/* Generate model selection */}
              <div>
                <label className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--na-text-secondary)' }}>{t('generateModel')}</label>
                <select
                  value={generateModel}
                  onChange={(e) => setGenerateModel(e.target.value)}
                  className="w-full text-[12px] px-3 py-2 outline-none"
                  style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-panel)', color: 'var(--na-text-primary)' }}
                >
                  <option value="">{getModelDisplay(generalConfig.reportGenerateModel || '')}</option>
                  {allModels.map((m) => (
                    <option key={`${m.provider.id}-${m.model}`} value={m.model}>{m.provider.name} / {m.model}</option>
                  ))}
                </select>
                <p className="text-[10px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>{t('generateModelHint')}</p>
              </div>
            </div>
          )}

          {/* Step 2: Generate */}
          {step === 2 && (
            <div className="space-y-3">
              {isGenerating && (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('generating')}
                </div>
              )}
              {generatedFile && (
                <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--na-bg-active)', border: '1px solid var(--na-border-subtle)' }}>
                  <FileText className="w-3.5 h-3.5" style={{ color: 'var(--na-accent)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--na-text-primary)' }}>{generatedFile}</span>
                </div>
              )}
              {(generatedContent || isGenerating) && (
                <div
                  ref={contentRef}
                  className="p-3 text-[12px] leading-relaxed overflow-auto max-h-[50vh] font-mono whitespace-pre-wrap"
                  style={{ borderRadius: 'var(--na-radius-md)', border: '1px solid var(--na-border-default)', background: 'var(--na-bg-active)', color: 'var(--na-text-primary)' }}
                >
                  {generatedContent || '等待生成...'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--na-border-subtle)' }}>
          <div className="flex items-center gap-2">
            {step > 0 && step !== 2 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1 px-4 py-1.5 text-[12px] rounded-lg transition-colors"
                style={{ color: 'var(--na-text-secondary)' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> 上一步
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 0 && (
              <>
                <button onClick={onClose} className="px-4 py-1.5 text-[12px] rounded-lg transition-colors" style={{ color: 'var(--na-text-secondary)' }}>
                  {t('cancel')}
                </button>
                <button
                  onClick={() => { if (canProceed()) setStep(1) }}
                  disabled={!canProceed()}
                  className="flex items-center gap-1 px-5 py-1.5 text-[12px] rounded-lg font-medium transition-colors"
                  style={{ background: 'var(--na-accent)', color: '#fff', opacity: !canProceed() ? 0.6 : 1 }}
                >
                  {t('next')} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {step === 1 && (
              <>
                <button onClick={() => setStep(0)} className="px-4 py-1.5 text-[12px] rounded-lg transition-colors" style={{ color: 'var(--na-text-secondary)' }}>{t('prev')}</button>
                <button
                  onClick={handleGenerate}
                  disabled={!canProceed() || isGenerating}
                  className="flex items-center gap-1.5 px-5 py-1.5 text-[12px] rounded-lg font-medium transition-colors"
                  style={{ background: 'var(--na-accent)', color: '#fff', opacity: (!canProceed() || isGenerating) ? 0.6 : 1 }}
                >
                  {isGenerating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isGenerating ? t('generating') : t('generateReport')}
                </button>
              </>
            )}
            {step === 2 && !isGenerating && (
              <button onClick={onClose} className="px-5 py-1.5 text-[12px] rounded-lg font-medium transition-colors" style={{ background: 'var(--na-accent)', color: '#fff' }}>
                {t('finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
