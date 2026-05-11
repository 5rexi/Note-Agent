import { useState, useEffect } from 'react'
import { Terminal, Monitor, Command, AlertTriangle, FolderOpen } from 'lucide-react'

interface ShellEnvSetupModalProps {
  onComplete: () => void
}

export default function ShellEnvSetupModal({ onComplete }: ShellEnvSetupModalProps) {
  const [detected, setDetected] = useState<{ gitbash?: string; wsl: boolean }>({ wsl: false })
  const [selected, setSelected] = useState<'gitbash' | 'wsl' | 'native' | null>(null)
  const [gitBashPath, setGitBashPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const d = await window.electronAPI.shellEnvDetect()
        setDetected(d)
        if (d.gitbash) {
          setSelected('gitbash')
          setGitBashPath(d.gitbash)
        } else if (d.wsl) {
          setSelected('wsl')
        } else {
          setSelected('native')
        }
      } catch {}
      setLoading(false)
    })()
  }, [])

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await window.electronAPI.shellEnvSet({
        type: selected,
        path: selected === 'gitbash' ? gitBashPath || undefined : undefined,
      })
      onComplete()
    } catch {}
    setSaving(false)
  }

  const handleBrowseGitBash = async () => {
    try {
      const result = await window.electronAPI.openFile({
        multiple: false,
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      })
      if (result.paths.length > 0) {
        setGitBashPath(result.paths[0])
        setSelected('gitbash')
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="p-8 rounded-xl" style={{ background: 'var(--na-bg-popover)' }}>
          <div className="text-[14px]" style={{ color: 'var(--na-text-secondary)' }}>正在检测环境...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[480px] max-w-[90vw] p-6 rounded-xl space-y-5" style={{ background: 'var(--na-bg-popover)', boxShadow: 'var(--na-shadow-lg)' }}>
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5" style={{ color: 'var(--na-accent)' }} />
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>配置命令执行环境</h2>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--na-text-secondary)' }}>
          检测到您在 Windows 上运行。AI 助手经常需要执行命令（如编译、生成文件等）。
          请选择一个命令执行环境以获得最佳兼容性：
        </p>

        <div className="space-y-2">
          {/* Git Bash */}
          <button
            onClick={() => setSelected('gitbash')}
            className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all"
            style={{
              border: selected === 'gitbash' ? '2px solid var(--na-accent)' : '1px solid var(--na-border-subtle)',
              background: selected === 'gitbash' ? 'var(--na-bg-active)' : 'transparent',
            }}
          >
            <Command className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--na-accent)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
                Git Bash {detected.gitbash ? '（已检测到）' : '（未检测到）'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
                最佳兼容性。支持全部 bash 语法（&&、||、mkdir -p 等）。
              </div>
              {selected === 'gitbash' && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={gitBashPath}
                    onChange={(e) => setGitBashPath(e.target.value)}
                    placeholder="bash.exe 路径"
                    className="flex-1 text-[11px] px-2 py-1.5 rounded outline-none"
                    style={{ background: 'var(--na-bg-sidebar)', border: '1px solid var(--na-border-default)', color: 'var(--na-text-primary)' }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleBrowseGitBash() }}
                    className="p-1.5 rounded hover:bg-[var(--na-bg-hover)]"
                    style={{ color: 'var(--na-text-tertiary)' }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </button>

          {/* WSL */}
          <button
            onClick={() => setSelected('wsl')}
            disabled={!detected.wsl}
            className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all disabled:opacity-40"
            style={{
              border: selected === 'wsl' ? '2px solid var(--na-accent)' : '1px solid var(--na-border-subtle)',
              background: selected === 'wsl' ? 'var(--na-bg-active)' : 'transparent',
            }}
          >
            <Monitor className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--na-accent)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium" style={{ color: 'var(--na-text-primary)' }}>
                WSL {detected.wsl ? '（已安装）' : '（未安装）'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
                完整的 Linux 子系统环境。命令在 Linux 中执行，行为与 Linux 完全一致。
              </div>
            </div>
          </button>

          {/* Native */}
          <button
            onClick={() => setSelected('native')}
            className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all"
            style={{
              border: selected === 'native' ? '2px solid var(--na-accent)' : '1px solid var(--na-border-subtle)',
              background: selected === 'native' ? 'var(--na-bg-active)' : 'transparent',
            }}
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--na-text-tertiary)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium" style={{ color: 'var(--na-text-primary)' }}>原生 cmd / PowerShell</div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
                无需额外安装。但部分 bash 命令（mkdir -p、unzip、sed 等）可能无法执行，AI 兼容性受限。
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={!selected || saving || (selected === 'gitbash' && !gitBashPath)}
            className="px-4 py-2 text-[12px] font-medium rounded-lg transition-opacity disabled:opacity-40"
            style={{ background: 'var(--na-accent)', color: '#fff' }}
          >
            {saving ? '保存中...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
