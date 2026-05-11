import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  Search, FolderInput, Download, Loader2, CheckCircle2, AlertCircle,
  ToggleLeft, ToggleRight, FileText, Trash2,
} from 'lucide-react'

interface WordConfig {
  enabled: boolean
  sofficeType: 'system-auto' | 'system-manual' | 'bundled' | null
  sofficePath: string
  bundledPath: string
}

interface WordSupportCardProps {
  config: WordConfig
  onChange: (config: WordConfig) => void
}

export default function WordSupportCard({ config, onChange }: WordSupportCardProps) {
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual' | 'bundled' | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<Array<{ name: string; path: string }> | null>(null)
  const [bundledExists, setBundledExists] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [platform, setPlatform] = useState('')

  const downloadTaskIdRef = useRef<string | null>(null)

  const hasSoffice = !!config.sofficeType && (
    config.sofficeType === 'bundled'
      ? !!config.bundledPath
      : !!config.sofficePath
  )

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform)
  }, [])

  useEffect(() => {
    if (config.sofficeType === 'system-auto') setSelectedMode('auto')
    else if (config.sofficeType === 'system-manual') setSelectedMode('manual')
    else if (config.sofficeType === 'bundled') setSelectedMode('bundled')
    else setSelectedMode(null)
  }, [config.sofficeType])

  // Check bundled status on mount
  const autoFixedRef = useRef(false)
  useEffect(() => {
    if (autoFixedRef.current) return

    window.electronAPI.wordGetBundledPath().then((r) => {
      const exists = !!r.path
      setBundledExists(exists)

      if (exists) {
        if (config.sofficeType !== 'bundled' || !config.bundledPath) {
          autoFixedRef.current = true
          window.electronAPI.wordVerifySoffice(r.path!).then((v) => {
            if (v.ok) {
              onChange({
                ...config,
                sofficeType: 'bundled',
                sofficePath: r.path!,
                bundledPath: r.path!,
              })
            }
          })
        }
      } else {
        if (config.sofficeType === 'bundled') {
          autoFixedRef.current = true
          onChange({
            enabled: false,
            sofficeType: null,
            sofficePath: '',
            bundledPath: '',
          })
        }
      }
    })

    // Restore running download tasks
    window.electronAPI.taskList().then((list: any[]) => {
      const runningDownload = list.find((t) => t.type === 'libreoffice-download' && (t.status === 'running' || t.status === 'pending'))
      if (runningDownload) {
        setDownloading(true)
        setDownloadTaskId(runningDownload.id)
        downloadTaskIdRef.current = runningDownload.id
        setDownloadProgress(runningDownload.progress ?? 0)
      }
    })
  }, [config, onChange])

  // Global task event listeners
  useEffect(() => {
    const unsubProgress = window.electronAPI.onTaskProgress((taskId, progress) => {
      if (taskId === downloadTaskIdRef.current) {
        setDownloadProgress(progress)
      }
    })
    const unsubCompleted = window.electronAPI.onTaskCompleted((taskId) => {
      if (taskId === downloadTaskIdRef.current) {
        setDownloading(false)
        setDownloadProgress(100)
        setBundledExists(true)
        downloadTaskIdRef.current = null
        setDownloadTaskId(null)
        window.electronAPI.wordGetBundledPath().then((r) => {
          const bundledPath = r.path
          if (bundledPath) {
            toast.info('正在验证下载的 LibreOffice...')
            if (platform === 'win32') {
              toast.info('验证时会弹出 CMD 窗口，完成后请按回车关闭')
            }
            window.electronAPI.wordVerifySoffice(bundledPath).then((verify) => {
              if (verify.ok) {
                onChange({
                  enabled: true,
                  sofficeType: 'bundled',
                  sofficePath: bundledPath,
                  bundledPath: bundledPath,
                })
                toast.success('LibreOffice 下载并验证通过，Word 支持已启用')
              } else {
                toast.error('LibreOffice 验证失败: ' + (verify.error || '无法执行'))
              }
            })
          } else {
            toast.error('下载完成但未找到 soffice 文件')
          }
        })
      }
    })
    const unsubFailed = window.electronAPI.onTaskFailed((taskId, error) => {
      if (taskId === downloadTaskIdRef.current) {
        setDownloading(false)
        setDownloadError(error)
        downloadTaskIdRef.current = null
        setDownloadTaskId(null)
      }
    })

    return () => {
      unsubProgress()
      unsubCompleted()
      unsubFailed()
    }
  }, [onChange])

  const handleAutoDetect = useCallback(async () => {
    setChecking(true)
    setCheckResult(null)
    try {
      const result = await window.electronAPI.wordCheckEnv()
      setCheckResult(result.found)
      if (result.found && result.found.length > 0) {
        const first = result.found[0]
        toast.info(`正在验证 ${first.name}...`)
        if (platform === 'win32') {
          toast.info('验证时会弹出 CMD 窗口，完成后请按回车关闭')
        }
        const verify = await window.electronAPI.wordVerifySoffice(first.path)
        if (verify.ok) {
          onChange({
            enabled: true,
            sofficeType: 'system-auto',
            sofficePath: first.path,
            bundledPath: config.bundledPath,
          })
          toast.success(`${first.name} 验证通过，Word 支持已启用`)
        } else {
          toast.error(`${first.name} 验证失败: ${verify.error || '无法执行'}`)
        }
      } else {
        toast.info('未检测到 LibreOffice (soffice)')
      }
    } catch (e: any) {
      setCheckResult([])
      toast.error('检测失败: ' + (e.message || '未知错误'))
    } finally {
      setChecking(false)
    }
  }, [config.bundledPath, onChange])

  const handleManualSelect = useCallback(async () => {
    const result = await window.electronAPI.openFile({ multiple: false })
    if (!result.canceled && result.paths.length > 0) {
      const path = result.paths[0]
      toast.info('正在验证 soffice...')
      if (platform === 'win32') {
        toast.info('验证时会弹出 CMD 窗口，完成后请按回车关闭')
      }
      const verify = await window.electronAPI.wordVerifySoffice(path)
      if (verify.ok) {
        onChange({
          enabled: true,
          sofficeType: 'system-manual',
          sofficePath: path,
          bundledPath: config.bundledPath,
        })
        toast.success('soffice 验证通过')
      } else {
        toast.error('soffice 验证失败: ' + (verify.error || '无法执行'))
      }
    }
  }, [config.bundledPath, onChange])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    setDownloadError(null)
    setDownloadProgress(0)
    try {
      const result = await window.electronAPI.wordDownloadLibreOffice()
      if (result.error) {
        setDownloadError(result.error)
        setDownloading(false)
      } else if (result.taskId) {
        setDownloadTaskId(result.taskId)
        downloadTaskIdRef.current = result.taskId
      }
    } catch (e: any) {
      setDownloadError(e.message || '下载失败')
      setDownloading(false)
    }
  }, [])

  const handleToggle = useCallback(() => {
    if (!hasSoffice) {
      toast.info('请先选择并验证一种 LibreOffice 配置方式')
      return
    }
    onChange({ ...config, enabled: !config.enabled })
  }, [config, hasSoffice, onChange])

  const handleClear = useCallback(() => {
    onChange({
      enabled: false,
      sofficeType: null,
      sofficePath: '',
      bundledPath: '',
    })
    setCheckResult(null)
    setSelectedMode(null)
    toast.success('Word 配置已清除')
  }, [onChange])

  const handleRemoveBundled = useCallback(async () => {
    const result = await window.electronAPI.wordRemoveBundled()
    if (result.success) {
      setBundledExists(false)
      if (config.sofficeType === 'bundled') {
        onChange({
          enabled: false,
          sofficeType: null,
          sofficePath: '',
          bundledPath: '',
        })
      }
      toast.success('LibreOffice 已删除')
    } else {
      toast.error('删除失败: ' + (result.error || '未知错误'))
    }
  }, [config.sofficeType, onChange])

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{
        background: 'var(--na-bg-panel)',
        border: '1px solid var(--na-border-subtle)',
        boxShadow: 'var(--na-shadow-sm)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(37,99,235,0.08)' }}
          >
            <FileText className="w-5 h-5" style={{ color: 'var(--na-status-explore)' }} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>Word</h3>
            <p className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
              支持 .docx/.doc 预览与编辑（基于 LibreOffice）
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasSoffice && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors hover:opacity-70"
              style={{ color: 'var(--na-status-explore)' }}
              title="移除配置"
            >
              <Trash2 className="w-3 h-3" />
              移除
            </button>
          )}
          <button
            onClick={handleToggle}
            className="transition-opacity"
            style={{ opacity: hasSoffice ? 1 : 0.4, cursor: hasSoffice ? 'pointer' : 'not-allowed' }}
          >
            {config.enabled ? (
              <ToggleRight className="w-8 h-8" style={{ color: 'var(--na-status-explore)' }} />
            ) : (
              <ToggleLeft className="w-8 h-8" style={{ color: 'var(--na-text-tertiary)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Status indicator */}
      {config.sofficeType && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--na-bg-active)' }}>
          <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--na-status-explore)' }} />
          <span style={{ color: 'var(--na-text-secondary)' }}>
            当前配置：{config.sofficeType === 'system-auto' ? '自动检测' : config.sofficeType === 'system-manual' ? '手动选择' : '内置下载'}
            {config.sofficePath && ` (${window.electronAPI.pathBasename(config.sofficePath)})`}
          </span>
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--na-border-subtle)' }} />

      {/* Configuration options */}
      <div className="space-y-3">
        <div className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>
          配置 LibreOffice
        </div>

        {platform === 'win32' && (
          <>
            {/* Windows: Download & Install button (standalone, not a radio option) */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-subtle)' }}>
              <div className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>还没有 LibreOffice？</div>
              <p className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
                下载约 350MB 的 LibreOffice MSI 安装包，下载完成后会自动打开安装向导，按提示完成安装即可。
              </p>
              <div>
                {bundledExists ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                      <CheckCircle2 className="w-3 h-3" />
                      <span>已下载安装包</span>
                    </div>
                    <button
                      onClick={handleRemoveBundled}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors hover:opacity-70"
                      style={{ color: 'var(--na-status-explore)' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      删除
                    </button>
                  </div>
                ) : downloading ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>下载中 {downloadProgress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--na-bg-sidebar)', width: 200 }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${downloadProgress}%`, background: 'var(--na-status-explore)' }} />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors"
                    style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
                  >
                    <Download className="w-3 h-3" />
                    下载并安装
                  </button>
                )}
                {downloadError && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                    <AlertCircle className="w-3 h-3" />
                    <span>{downloadError}</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--na-border-subtle)' }} />

            {/* Auto detect */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: selectedMode === 'auto' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)', border: `1px solid ${selectedMode === 'auto' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}` }}>
              <div className="flex items-center gap-2">
                <input type="radio" name="word-mode" checked={selectedMode === 'auto'} onChange={() => setSelectedMode('auto')} className="accent-blue-500" />
                <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>自动检测 PATH</span>
              </div>
              <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>扫描系统 PATH，自动查找 soffice.exe</p>
              <div className="pl-5">
                <button onClick={handleAutoDetect} disabled={checking} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  {checking ? '检测中...' : '自动检测'}
                </button>
                {checkResult && checkResult.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {checkResult.map((c) => (
                      <div key={c.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{c.name} @ {c.path}</span>
                      </div>
                    ))}
                  </div>
                )}
                {checkResult && checkResult.length === 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                    <AlertCircle className="w-3 h-3" />
                    <span>未找到 LibreOffice</span>
                  </div>
                )}
              </div>
            </div>

            {/* Manual select */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: selectedMode === 'manual' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)', border: `1px solid ${selectedMode === 'manual' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}` }}>
              <div className="flex items-center gap-2">
                <input type="radio" name="word-mode" checked={selectedMode === 'manual'} onChange={() => setSelectedMode('manual')} className="accent-blue-500" />
                <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>手动选择路径</span>
              </div>
              <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
                如果自动检测不到，请手动选择 soffice.exe 路径（通常在 <strong>LibreOffice\program\soffice.exe</strong> 下）
              </p>
              <div className="pl-5 flex items-center gap-2">
                <button onClick={handleManualSelect} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                  <FolderInput className="w-3 h-3" />
                  选择文件
                </button>
                {config.sofficeType === 'system-manual' && config.sofficePath && (
                  <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--na-text-tertiary)' }}>{config.sofficePath}</span>
                )}
              </div>
            </div>
          </>
        )}

        {platform !== 'win32' && (
          <>
            {/* Linux / macOS: keep original 3 radio options */}
            {/* Option 1: Auto detect */}
            <div className="rounded-lg p-3 space-y-2 transition-colors" style={{ background: selectedMode === 'auto' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)', border: `1px solid ${selectedMode === 'auto' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}` }}>
              <div className="flex items-center gap-2">
                <input type="radio" name="word-mode" checked={selectedMode === 'auto'} onChange={() => setSelectedMode('auto')} className="accent-blue-500" />
                <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>自动检测 PATH</span>
              </div>
              <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>扫描系统 PATH 环境变量，自动查找 soffice / libreoffice</p>
              <div className="pl-5">
                <button onClick={handleAutoDetect} disabled={checking} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  {checking ? '检测中...' : '自动检测'}
                </button>
                {checkResult && checkResult.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {checkResult.map((c) => (
                      <div key={c.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{c.name} @ {c.path}</span>
                      </div>
                    ))}
                  </div>
                )}
                {checkResult && checkResult.length === 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                    <AlertCircle className="w-3 h-3" />
                    <span>未找到 LibreOffice</span>
                  </div>
                )}
              </div>
            </div>

            {/* Option 2: Manual */}
            <div className="rounded-lg p-3 space-y-2 transition-colors" style={{ background: selectedMode === 'manual' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)', border: `1px solid ${selectedMode === 'manual' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}` }}>
              <div className="flex items-center gap-2">
                <input type="radio" name="word-mode" checked={selectedMode === 'manual'} onChange={() => setSelectedMode('manual')} className="accent-blue-500" />
                <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>手动选择路径</span>
              </div>
              <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>选择已安装的 LibreOffice 可执行文件（soffice、libreoffice）</p>
              <div className="pl-5 flex items-center gap-2">
                <button onClick={handleManualSelect} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                  <FolderInput className="w-3 h-3" />
                  选择文件
                </button>
                {config.sofficeType === 'system-manual' && config.sofficePath && (
                  <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--na-text-tertiary)' }}>{config.sofficePath}</span>
                )}
              </div>
            </div>

            {/* Option 3: Bundled download */}
            <div className="rounded-lg p-3 space-y-2 transition-colors" style={{ background: selectedMode === 'bundled' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)', border: `1px solid ${selectedMode === 'bundled' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}` }}>
              <div className="flex items-center gap-2">
                <input type="radio" name="word-mode" checked={selectedMode === 'bundled'} onChange={() => setSelectedMode('bundled')} className="accent-blue-500" />
                <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>内置下载 LibreOffice</span>
              </div>
              <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>自动下载并解压 LibreOffice，无需额外安装（可能需要几分钟）</p>
              <div className="pl-5">
                {bundledExists ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                      <CheckCircle2 className="w-3 h-3" />
                      <span>LibreOffice 已安装</span>
                    </div>
                    <button onClick={handleRemoveBundled} className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors hover:opacity-70" style={{ color: 'var(--na-status-explore)' }}>
                      <Trash2 className="w-3 h-3" />
                      删除
                    </button>
                  </div>
                ) : downloading ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>下载中 {downloadProgress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--na-bg-sidebar)', width: 200 }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${downloadProgress}%`, background: 'var(--na-status-explore)' }} />
                    </div>
                  </div>
                ) : (
                  <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors" style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}>
                    <Download className="w-3 h-3" />
                    开始下载
                  </button>
                )}
                {downloadError && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                    <AlertCircle className="w-3 h-3" />
                    <span>{downloadError}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
