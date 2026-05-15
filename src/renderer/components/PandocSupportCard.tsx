import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  Search, FolderInput, Download, Loader2, CheckCircle2, AlertCircle,
  ToggleLeft, ToggleRight, FileText, Trash2, Copy,
} from 'lucide-react'

interface PandocConfig {
  enabled: boolean
  path: string | null
}

interface PandocSupportCardProps {
  config: PandocConfig
  onChange: (config: PandocConfig) => void
}

export default function PandocSupportCard({ config, onChange }: PandocSupportCardProps) {
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual' | 'bundled' | 'install' | null>(null)
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<{ installed: boolean; path: string | null; version: string | null } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [bundledExists, setBundledExists] = useState(false)
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const downloadTaskIdRef = useRef<string | null>(null)

  // Restore mode from config
  useEffect(() => {
    if (config.path) {
      // Determine mode from path
      window.electronAPI.pandocGetBundledPath().then((r) => {
        if (r.path && config.path === r.path) {
          setSelectedMode('bundled')
        } else {
          setSelectedMode('auto')
        }
      })
    } else {
      setSelectedMode(null)
    }
  }, [config.path])

  // Silent check on mount — no toasts, just update UI state
  const silentCheckedRef = useRef(false)
  useEffect(() => {
    if (silentCheckedRef.current) return
    silentCheckedRef.current = true

    // Check bundled status
    window.electronAPI.pandocGetBundledPath().then((r) => {
      const exists = !!r.path
      setBundledExists(exists)

      // If bundled exists but config doesn't know about it, auto-enable silently
      if (exists && !config.path) {
        onChange({ enabled: true, path: r.path })
        setSelectedMode('bundled')
      }
    })

    // Silent PATH check (no toast)
    window.electronAPI.wordGetPandocInfo().then((result) => {
      setInfo(result)
      // If found and no config yet, silently enable
      if (result.installed && result.path && !config.path) {
        onChange({ enabled: true, path: result.path })
        setSelectedMode('auto')
      }
    }).catch(() => {
      setInfo({ installed: false, path: null, version: null })
    })

    // Restore any running pandoc-download tasks
    window.electronAPI.taskList().then((list: any[]) => {
      const runningDownload = list.find((t) => t.type === 'pandoc-download' && (t.status === 'running' || t.status === 'pending'))
      if (runningDownload) {
        setInstalling(true)
        setDownloadTaskId(runningDownload.id)
        downloadTaskIdRef.current = runningDownload.id
        setDownloadProgress(runningDownload.progress ?? 0)
      }
    })
  }, [config.path, onChange])

  // Global task event listeners — set ONCE on mount
  useEffect(() => {
    const unsubProgress = window.electronAPI.onTaskProgress((taskId, progress) => {
      if (taskId === downloadTaskIdRef.current) {
        setDownloadProgress(progress)
      }
    })
    const unsubCompleted = window.electronAPI.onTaskCompleted((taskId) => {
      if (taskId === downloadTaskIdRef.current) {
        setInstalling(false)
        setDownloadProgress(100)
        setBundledExists(true)
        downloadTaskIdRef.current = null
        setDownloadTaskId(null)
        window.electronAPI.pandocGetBundledPath().then((r) => {
          const bundledPath = r.path
          if (bundledPath) {
            window.electronAPI.wordVerifyPandoc(bundledPath).then((verify) => {
              if (verify.ok) {
                onChange({ enabled: true, path: bundledPath })
                setSelectedMode('bundled')
                toast.success('pandoc 下载并验证通过，支持已启用')
              } else {
                toast.error('pandoc 验证失败: ' + (verify.error || '无法执行'))
              }
            })
          } else {
            toast.error('下载完成但未找到 pandoc 文件')
          }
        })
      }
    })
    const unsubFailed = window.electronAPI.onTaskFailed((taskId, error) => {
      if (taskId === downloadTaskIdRef.current) {
        setInstalling(false)
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

  // User-initiated auto detect (with toast feedback)
  const handleAutoDetect = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.electronAPI.wordGetPandocInfo()
      setInfo(result)
      if (result.installed && result.path) {
        onChange({ enabled: true, path: result.path })
        setSelectedMode('auto')
        toast.success(`pandoc 检测成功: ${result.version || result.path}`)
      } else {
        onChange({ enabled: false, path: null })
        setSelectedMode(null)
        toast.info('未检测到 pandoc')
      }
    } catch (e: any) {
      toast.error('检测失败: ' + (e.message || '未知错误'))
    } finally {
      setChecking(false)
    }
  }, [onChange])

  const handleManualSelect = useCallback(async () => {
    const result = await window.electronAPI.openFile({ multiple: false })
    if (!result.canceled && result.paths.length > 0) {
      const path = result.paths[0]
      toast.info('正在验证 pandoc...')
      const verify = await window.electronAPI.wordVerifyPandoc(path)
      if (verify.ok) {
        onChange({ enabled: true, path })
        setSelectedMode('manual')
        toast.success(`pandoc 验证通过: ${verify.version}`)
      } else {
        toast.error('验证失败: ' + (verify.error || '无法执行'))
      }
    }
  }, [onChange])

  const handleDownload = useCallback(async () => {
    setInstalling(true)
    setDownloadError(null)
    setDownloadProgress(0)
    try {
      const result = await window.electronAPI.pandocDownload()
      if (result.error) {
        setDownloadError(result.error)
        setInstalling(false)
      } else if (result.taskId) {
        setDownloadTaskId(result.taskId)
        downloadTaskIdRef.current = result.taskId
      }
    } catch (e: any) {
      setDownloadError(e.message || '下载失败')
      setInstalling(false)
    }
  }, [])

  const handleToggle = useCallback(() => {
    if (!config.path) {
      toast.info('请先选择或检测 pandoc 路径')
      return
    }
    onChange({ ...config, enabled: !config.enabled })
  }, [config, onChange])

  const handleClear = useCallback(() => {
    onChange({ enabled: false, path: null })
    setSelectedMode(null)
    setInfo(null)
    toast.success('Pandoc 配置已清除')
  }, [onChange])

  const handleRemoveBundled = useCallback(async () => {
    const result = await window.electronAPI.pandocRemoveBundled()
    if (result.success) {
      setBundledExists(false)
      if (config.path) {
        window.electronAPI.pandocGetBundledPath().then((r) => {
          if (config.path === r.path) {
            onChange({ enabled: false, path: null })
            setSelectedMode(null)
          }
        })
      }
      toast.success('pandoc 内置版本已删除')
    } else {
      toast.error('删除失败: ' + (result.error || '未知错误'))
    }
  }, [config.path, onChange])

  const handleCopyCmd = useCallback(() => {
    const isWin = navigator.platform.startsWith('Win')
    const isMac = navigator.platform.startsWith('Mac')
    const cmd = isWin
      ? 'winget install JohnMacFarlane.Pandoc'
      : isMac
        ? 'brew install pandoc'
        : 'sudo apt install pandoc'
    navigator.clipboard.writeText(cmd)
    toast.success('安装命令已复制到剪贴板')
  }, [])

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
            style={{ background: 'rgba(59,130,246,0.08)' }}
          >
            <FileText className="w-5 h-5" style={{ color: 'var(--na-accent)' }} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>Pandoc</h3>
            <p className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
              支持 .doc 转 .docx、PPTX 转 PDF
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {config.path && (
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
            style={{ opacity: config.path ? 1 : 0.4, cursor: config.path ? 'pointer' : 'not-allowed' }}
          >
            {config.enabled ? (
              <ToggleRight className="w-8 h-8" style={{ color: 'var(--na-status-ask)' }} />
            ) : (
              <ToggleLeft className="w-8 h-8" style={{ color: 'var(--na-text-tertiary)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Status indicator */}
      {config.path && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--na-bg-active)' }}>
          <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--na-status-ask)' }} />
          <span style={{ color: 'var(--na-text-secondary)' }}>
            当前配置：{info?.version || 'pandoc'} @ {config.path}
          </span>
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--na-border-subtle)' }} />

      {/* Configuration options */}
      <div className="space-y-3">
        <div className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>
          配置 Pandoc
        </div>

        {/* Option 1: Auto detect */}
        <div
          className="rounded-lg p-3 space-y-2 transition-colors"
          style={{
            background: selectedMode === 'auto' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)',
            border: `1px solid ${selectedMode === 'auto' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <input
              type="radio"
              name="pandoc-mode"
              checked={selectedMode === 'auto'}
              onChange={() => setSelectedMode('auto')}
              className="accent-blue-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              自动检测 PATH
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            扫描系统 PATH 环境变量，自动查找 pandoc
          </p>
          <div className="pl-5">
            <button
              onClick={handleAutoDetect}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors"
              style={{
                background: 'var(--na-bg-panel)',
                color: 'var(--na-text-secondary)',
                border: '1px solid var(--na-border-subtle)',
              }}
            >
              {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              {checking ? '检测中...' : '自动检测'}
            </button>
            {info && info.installed && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-ask)' }}>
                <CheckCircle2 className="w-3 h-3" />
                <span>{info.version || info.path}</span>
              </div>
            )}
            {info && !info.installed && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                <AlertCircle className="w-3 h-3" />
                <span>未找到 pandoc</span>
              </div>
            )}
          </div>
        </div>

        {/* Option 2: Manual */}
        <div
          className="rounded-lg p-3 space-y-2 transition-colors"
          style={{
            background: selectedMode === 'manual' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)',
            border: `1px solid ${selectedMode === 'manual' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <input
              type="radio"
              name="pandoc-mode"
              checked={selectedMode === 'manual'}
              onChange={() => setSelectedMode('manual')}
              className="accent-blue-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              手动选择路径
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            选择已安装的 pandoc 可执行文件
          </p>
          <div className="pl-5 flex items-center gap-2">
            <button
              onClick={handleManualSelect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors"
              style={{
                background: 'var(--na-bg-panel)',
                color: 'var(--na-text-secondary)',
                border: '1px solid var(--na-border-subtle)',
              }}
            >
              <FolderInput className="w-3 h-3" />
              选择文件
            </button>
            {config.path && selectedMode === 'manual' && (
              <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--na-text-tertiary)' }}>
                {config.path}
              </span>
            )}
          </div>
        </div>

        {/* Option 3: Bundled download */}
        <div
          className="rounded-lg p-3 space-y-2 transition-colors"
          style={{
            background: selectedMode === 'bundled' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)',
            border: `1px solid ${selectedMode === 'bundled' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <input
              type="radio"
              name="pandoc-mode"
              checked={selectedMode === 'bundled'}
              onChange={() => setSelectedMode('bundled')}
              className="accent-blue-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              内置 Pandoc（一键下载）
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            自动下载约 30MB 的 pandoc，无需系统包管理器权限
          </p>
          <div className="pl-5">
            {bundledExists ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-ask)' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>pandoc 已下载</span>
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
            ) : installing ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-text-secondary)' }}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>下载中 {downloadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--na-bg-sidebar)', width: 200 }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${downloadProgress}%`,
                      background: 'var(--na-status-ask)',
                    }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors"
                style={{
                  background: 'var(--na-bg-panel)',
                  color: 'var(--na-text-secondary)',
                  border: '1px solid var(--na-border-subtle)',
                }}
              >
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

        {/* Option 4: System package manager (reference only) */}
        <div
          className="rounded-lg p-3 space-y-2 transition-colors"
          style={{
            background: selectedMode === 'install' ? 'var(--na-bg-active)' : 'var(--na-bg-sidebar)',
            border: `1px solid ${selectedMode === 'install' ? 'var(--na-accent)' : 'var(--na-border-subtle)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <input
              type="radio"
              name="pandoc-mode"
              checked={selectedMode === 'install'}
              onChange={() => setSelectedMode('install')}
              className="accent-blue-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              系统包管理器安装
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            使用 winget / brew / apt 安装（需要管理员权限）
          </p>
          <div className="pl-5 space-y-2">
            <code
              className="block px-2 py-1 rounded text-[10px] font-mono"
              style={{ background: 'var(--na-bg-hover)', color: 'var(--na-text-primary)' }}
            >
              {navigator.platform.startsWith('Win')
                ? 'winget install JohnMacFarlane.Pandoc'
                : navigator.platform.startsWith('Mac')
                  ? 'brew install pandoc'
                  : 'sudo apt install pandoc'}
            </code>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCmd}
                className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-md transition-colors"
                style={{
                  background: 'var(--na-bg-panel)',
                  color: 'var(--na-text-secondary)',
                  border: '1px solid var(--na-border-subtle)',
                }}
              >
                <Copy className="w-3 h-3" />
                复制命令
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
