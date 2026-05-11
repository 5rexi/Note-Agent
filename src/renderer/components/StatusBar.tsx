import { useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { currentFilePathAtom } from '../atoms'
import { Loader2 } from 'lucide-react'

interface TaskInfo {
  id: string
  name: string
  status: string
  progress?: number
}

export default function StatusBar() {
  const currentFile = useAtomValue(currentFilePathAtom)
  const [tasks, setTasks] = useState<TaskInfo[]>([])

  useEffect(() => {
    // Initial load
    window.electronAPI.taskList().then((list: any[]) => {
      const running = list.filter((t) => t.status === 'running' || t.status === 'pending')
      setTasks(running)
    })

    // Subscribe to events
    const unsubProgress = window.electronAPI.onTaskProgress((taskId, progress) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress } : t))
      )
    })

    const unsubCompleted = window.electronAPI.onTaskCompleted((taskId) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
    })

    const unsubFailed = window.electronAPI.onTaskFailed((taskId) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
    })

    return () => {
      unsubProgress()
      unsubCompleted()
      unsubFailed()
    }
  }, [])

  const activeTask = tasks[0]

  return (
    <div
      className="flex items-center justify-between px-3 text-[11px] shrink-0 select-none"
      style={{
        height: 26,
        background: 'var(--na-bg-sidebar)',
        borderTop: '1px solid var(--na-border-subtle)',
        color: 'var(--na-text-tertiary)',
      }}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <span className="truncate">{currentFile || '无打开文件'}</span>
        {currentFile && (
          <>
            <span style={{ color: 'var(--na-border-default)' }}>|</span>
            <span>UTF-8</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {activeTask ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{activeTask.name}</span>
            {activeTask.progress !== undefined && (
              <>
                <div className="h-1 rounded-full overflow-hidden" style={{ width: 80, background: 'var(--na-bg-panel)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${activeTask.progress}%`,
                      background: 'var(--na-status-ask)',
                    }}
                  />
                </div>
                <span>{activeTask.progress}%</span>
              </>
            )}
            {tasks.length > 1 && (
              <span style={{ color: 'var(--na-text-tertiary)' }}>+{tasks.length - 1}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--na-status-ask)' }} />
            <span>就绪</span>
          </div>
        )}
      </div>
    </div>
  )
}
