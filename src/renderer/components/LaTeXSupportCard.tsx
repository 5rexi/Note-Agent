import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  Search, FolderInput, Download, Loader2, CheckCircle2, AlertCircle,
  ToggleLeft, ToggleRight, FileText, Trash2,
} from 'lucide-react'

interface LaTeXConfig {
  enabled: boolean
  compilerType: 'system-auto' | 'system-manual' | 'bundled' | null
  compilerPath: string
  bundledPath: string
}

interface LaTeXSupportCardProps {
  config: LaTeXConfig
  onChange: (config: LaTeXConfig) => void
}

export default function LaTeXSupportCard({ config, onChange }: LaTeXSupportCardProps) {
  const [selectedMode, setSelectedMode] = useState<'auto' | 'manual' | 'bundled' | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<Array<{ name: string; path: string }> | null>(null)
  const [bundledExists, setBundledExists] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Use ref to track current download task ID — avoids useEffect re-subscription race conditions
  const downloadTaskIdRef = useRef<string | null>(null)

  // hasCompiler: bundled type uses bundledPath from config (persisted), others use compilerPath
  const hasCompiler = !!config.compilerType && (
    config.compilerType === 'bundled'
      ? !!config.bundledPath
      : !!config.compilerPath
  )

  // Restore state from config
  useEffect(() => {
    if (config.compilerType === 'system-auto') setSelectedMode('auto')
    else if (config.compilerType === 'system-manual') setSelectedMode('manual')
    else if (config.compilerType === 'bundled') setSelectedMode('bundled')
    else setSelectedMode(null)
  }, [config.compilerType])

  // Check bundled status on mount — auto-detect if compiler exists but config is stale
  const autoFixedRef = useRef(false)
  useEffect(() => {
    if (autoFixedRef.current) return

    window.electronAPI.latexGetBundledPath().then((r) => {
      const exists = !!r.path
      setBundledExists(exists)

      if (exists) {
        // Compiler exists on disk but config doesn't know about it (or path is missing)
        if (config.compilerType !== 'bundled' || !config.bundledPath) {
          const bundledPath = r.path
          if (!bundledPath) return
          autoFixedRef.current = true
          window.electronAPI.latexVerifyCompiler(bundledPath).then((verify) => {
            if (verify.ok) {
              onChange({
                ...config,
                compilerType: 'bundled',
                compilerPath: bundledPath,
                bundledPath: bundledPath,
              })
            }
          })
        }
      } else {
        // Compiler was deleted but config still references it
        if (config.compilerType === 'bundled') {
          autoFixedRef.current = true
          onChange({
            enabled: false,
            compilerType: null,
            compilerPath: '',
            bundledPath: '',
          })
        }
      }
    })

    // Restore any running latex-download tasks
    window.electronAPI.taskList().then((list: any[]) => {
      const runningDownload = list.find((t) => t.type === 'latex-download' && (t.status === 'running' || t.status === 'pending'))
      if (runningDownload) {
        setDownloading(true)
        setDownloadTaskId(runningDownload.id)
        downloadTaskIdRef.current = runningDownload.id
        setDownloadProgress(runningDownload.progress ?? 0)
      }
    })
  }, [config, onChange])

  // Global task event listeners — set ONCE on mount, never re-subscribed
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
        // Get actual path and verify before enabling
        window.electronAPI.latexGetBundledPath().then((r) => {
          const bundledPath = r.path
          if (bundledPath) {
            toast.info('正在验证下载的编译器...')
            window.electronAPI.latexVerifyCompiler(bundledPath).then((verify) => {
              if (verify.ok) {
                onChange({
                  enabled: true,
                  compilerType: 'bundled',
                  compilerPath: bundledPath,
                  bundledPath: bundledPath,
                })
                toast.success('tectonic 下载并验证通过，LaTeX 支持已启用')
              } else {
                toast.error('tectonic 验证失败: ' + (verify.error || '无法执行'))
              }
            })
          } else {
            toast.error('下载完成但未找到编译器文件')
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
      const result = await window.electronAPI.latexCheckEnv()
      setCheckResult(result.found)
      if (result.found && result.found.length > 0) {
        const first = result.found[0]
        toast.info(`正在验证 ${first.name}...`)
        const verify = await window.electronAPI.latexVerifyCompiler(first.path)
        if (verify.ok) {
          onChange({
            enabled: true,
            compilerType: 'system-auto',
            compilerPath: first.path,
            bundledPath: config.bundledPath,
          })
          toast.success(`${first.name} 验证通过，LaTeX 支持已启用`)
        } else {
          toast.error(`${first.name} 验证失败: ${verify.error || '无法执行编译器'}`)
        }
      } else {
        toast.info('未检测到 LaTeX 编译器')
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
      toast.info('正在验证编译器...')
      const verify = await window.electronAPI.latexVerifyCompiler(path)
      if (verify.ok) {
        onChange({
          enabled: true,
          compilerType: 'system-manual',
          compilerPath: path,
          bundledPath: config.bundledPath,
        })
        toast.success('编译器验证通过')
      } else {
        toast.error('编译器验证失败: ' + (verify.error || '无法执行'))
      }
    }
  }, [config.bundledPath, onChange])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    setDownloadError(null)
    setDownloadProgress(0)
    try {
      const result = await window.electronAPI.latexDownloadTectonic()
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
    if (!hasCompiler) {
      toast.info('请先选择并验证一种 LaTeX 编译器配置方式')
      return
    }
    onChange({ ...config, enabled: !config.enabled })
  }, [config, hasCompiler, onChange])

  const handleClear = useCallback(() => {
    onChange({
      enabled: false,
      compilerType: null,
      compilerPath: '',
      bundledPath: '',
    })
    setCheckResult(null)
    setSelectedMode(null)
    toast.success('LaTeX 配置已清除')
  }, [onChange])

  const handleRemoveBundled = useCallback(async () => {
    const result = await window.electronAPI.latexRemoveBundled()
    if (result.success) {
      setBundledExists(false)
      if (config.compilerType === 'bundled') {
        onChange({
          enabled: false,
          compilerType: null,
          compilerPath: '',
          bundledPath: '',
        })
      }
      toast.success('tectonic 已删除')
    } else {
      toast.error('删除失败: ' + (result.error || '未知错误'))
    }
  }, [config.compilerType, onChange])

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
            style={{ background: 'rgba(5,150,105,0.08)' }}
          >
            <FileText className="w-5 h-5" style={{ color: 'var(--na-status-ask)' }} />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>LaTeX</h3>
            <p className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
              支持 .tex 编辑与预览、.bib/.bst 源码查看
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasCompiler && (
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
            style={{ opacity: hasCompiler ? 1 : 0.4, cursor: hasCompiler ? 'pointer' : 'not-allowed' }}
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
      {config.compilerType && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'var(--na-bg-active)' }}>
          <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--na-status-ask)' }} />
          <span style={{ color: 'var(--na-text-secondary)' }}>
            当前配置：{config.compilerType === 'system-auto' ? '自动检测' : config.compilerType === 'system-manual' ? '手动选择' : '内置下载'}
            {config.compilerPath && ` (${config.compilerPath.split('/').pop()})`}
          </span>
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--na-border-subtle)' }} />

      {/* Configuration options */}
      <div className="space-y-3">
        <div className="text-[11px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>
          配置编译器
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
              name="latex-mode"
              checked={selectedMode === 'auto'}
              onChange={() => setSelectedMode('auto')}
              className="accent-emerald-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              自动检测 PATH
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            扫描系统 PATH 环境变量，自动查找 tectonic / xelatex / lualatex / pdflatex
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
            {checkResult && checkResult.length > 0 && (
              <div className="mt-2 space-y-1">
                {checkResult.map((c) => (
                  <div key={c.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-ask)' }}>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{c.name} @ {c.path}</span>
                  </div>
                ))}
              </div>
            )}
            {checkResult && checkResult.length === 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-explore)' }}>
                <AlertCircle className="w-3 h-3" />
                <span>未找到 LaTeX 编译器</span>
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
              name="latex-mode"
              checked={selectedMode === 'manual'}
              onChange={() => setSelectedMode('manual')}
              className="accent-emerald-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              手动选择路径
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            选择已安装的 LaTeX 编译器可执行文件（tectonic、xelatex、lualatex、pdflatex）
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
            {config.compilerType === 'system-manual' && config.compilerPath && (
              <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--na-text-tertiary)' }}>
                {config.compilerPath}
              </span>
            )}
          </div>
        </div>

        {/* Option 3: Bundled */}
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
              name="latex-mode"
              checked={selectedMode === 'bundled'}
              onChange={() => setSelectedMode('bundled')}
              className="accent-emerald-500"
            />
            <span className="text-[12px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
              内置 LaTeX 服务（tectonic）
            </span>
          </div>
          <p className="text-[11px] pl-5" style={{ color: 'var(--na-text-tertiary)' }}>
            自动下载约 50MB 的 tectonic 编译器，无需额外安装
          </p>
          <div className="pl-5">
            {bundledExists ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--na-status-ask)' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>tectonic 已安装</span>
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
      </div>
    </div>
  )
}
