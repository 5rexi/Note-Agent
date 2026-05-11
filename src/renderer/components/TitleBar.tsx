import { useAtomValue } from 'jotai'
import { currentWorkspaceAtom, currentTaskAtom } from '../atoms'
import { Search, Sun, Moon } from 'lucide-react'
import { useState } from 'react'

export default function TitleBar() {
  const workspace = useAtomValue(currentWorkspaceAtom)
  const task = useAtomValue(currentTaskAtom)
  const [isDark, setIsDark] = useState(false)

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div
      className="flex items-center justify-between px-4 shrink-0 select-none"
      style={{
        height: 42,
        background: 'var(--na-bg-sidebar)',
        borderBottom: '1px solid var(--na-border-subtle)',
      }}
    >
      {/* Left: Logo + Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center font-bold text-sm"
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--na-radius-sm)',
            background: 'var(--na-accent)',
            color: '#fff',
          }}
        >
          N
        </div>
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-medium truncate" style={{ color: 'var(--na-text-primary)' }}>
            {workspace?.name || 'Note Agent'}
          </span>
          {task && (
            <>
              <span style={{ color: 'var(--na-text-tertiary)' }}>/</span>
              <span className="truncate" style={{ color: 'var(--na-text-secondary)' }}>
                {task.title}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Center: Search */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs"
        style={{
          width: 280,
          borderRadius: 'var(--na-radius-sm)',
          background: 'var(--na-bg-app)',
          color: 'var(--na-text-tertiary)',
        }}
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">搜索任务、文件或对话...</span>
      </div>

      {/* Right: Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="p-1.5 rounded-md transition-colors"
        style={{
          borderRadius: 'var(--na-radius-sm)',
          color: 'var(--na-text-tertiary)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--na-bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </div>
  )
}
