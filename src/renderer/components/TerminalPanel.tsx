import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, ChevronDown, ChevronUp } from 'lucide-react'

export interface TerminalPanelHandle {
  runCommand: (command: string) => void
}

interface TerminalPanelProps {
  visible: boolean
  onClose: () => void
  position: 'top' | 'bottom'
  onTogglePosition: () => void
  workspacePath?: string
}

const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ visible, onClose, position, onTogglePosition, workspacePath }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [shells, setShells] = useState<{ name: string; path: string }[]>([])
  const [currentShell, setCurrentShell] = useState('')
  const [ptyError, setPtyError] = useState<string | null>(null)
  const [initState, setInitState] = useState<'idle' | 'waiting_size' | 'opening' | 'creating' | 'ready'>('idle')
  const initAttemptsRef = useRef(0)
  const maxInitAttempts = 10
  const initStateRef = useRef(initState)
  const pendingCommandsRef = useRef<string[]>([])

  useEffect(() => { initStateRef.current = initState }, [initState])

  useImperativeHandle(ref, () => ({
    runCommand: (command: string) => {
      if (sessionIdRef.current && initStateRef.current === 'ready') {
        window.electronAPI.terminal.write(sessionIdRef.current, command + '\r')
      } else {
        pendingCommandsRef.current.push(command)
      }
    },
  }))

  // Initialize terminal
  useEffect(() => {
    if (!visible || !containerRef.current) return
    setPtyError(null)
    setInitState('waiting_size')
    initAttemptsRef.current = 0

    const container = containerRef.current

    // Wait for positive dimensions before initializing xterm
    function tryInit() {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        initTerminal()
      } else if (initAttemptsRef.current < maxInitAttempts) {
        initAttemptsRef.current++
        requestAnimationFrame(tryInit)
      } else {
        // Fallback: force layout recalc and try once more
        if (wrapperRef.current) {
          void wrapperRef.current.offsetHeight
          requestAnimationFrame(tryInit)
        }
      }
    }

    const rafId = requestAnimationFrame(tryInit)

    function initTerminal() {
      if (!containerRef.current || xtermRef.current) return
      setInitState('opening')

      const term = new Terminal({
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", "Consolas", "Courier New", monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          selectionBackground: '#264f78',
          black: '#1e1e1e',
          red: '#f48771',
          green: '#89d185',
          yellow: '#dcdcaa',
          blue: '#569cd6',
          magenta: '#c586c0',
          cyan: '#4ec9b0',
          white: '#d4d4d4',
          brightBlack: '#808080',
          brightRed: '#f48771',
          brightGreen: '#89d185',
          brightYellow: '#dcdcaa',
          brightBlue: '#569cd6',
          brightMagenta: '#c586c0',
          brightCyan: '#4ec9b0',
          brightWhite: '#ffffff',
        },
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: true,
        scrollback: 10000,
        convertEol: true,
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)

      // Force a layout reflow before fitting
      fitAddon.fit()

      xtermRef.current = term
      fitAddonRef.current = fitAddon

      // Create PTY session
      Promise.all([
        window.electronAPI.terminal.listShells(),
        window.electronAPI.terminal.getDefaultShell(),
      ]).then(([available, savedShell]) => {
        setShells(available)
        const defaultShell = savedShell && available.some((s) => s.path === savedShell)
          ? savedShell
          : available[0]?.path
        if (defaultShell) {
          setCurrentShell(defaultShell)
          createSession(term, fitAddon, defaultShell)
        } else {
          setPtyError('未检测到可用 shell')
          setInitState('idle')
        }
      }).catch((err) => {
        setPtyError(err?.message || '无法列出可用 shell')
        setInitState('idle')
      })
    }

    function createSession(term: Terminal, fitAddon: FitAddon, shellPath: string) {
      setInitState('creating')
      window.electronAPI.terminal.create({ shell: shellPath, cwd: workspacePath, workspacePath }).then((res) => {
        sessionIdRef.current = res.id
        // Re-fit after create to ensure PTY has correct dimensions
        fitAddon.fit()
        const { cols, rows } = term
        if (cols > 0 && rows > 0) {
          window.electronAPI.terminal.resize(res.id, cols, rows)
        }
        term.focus()
        setInitState('ready')
        // Flush any pending commands
        while (pendingCommandsRef.current.length > 0) {
          const cmd = pendingCommandsRef.current.shift()
          if (cmd) window.electronAPI.terminal.write(res.id, cmd + '\r')
        }
      }).catch((err) => {
        setPtyError(err?.message || '无法创建终端会话')
        setInitState('idle')
      })
    }

    return () => {
      cancelAnimationFrame(rafId)
      const id = sessionIdRef.current
      if (id) {
        window.electronAPI.terminal.kill(id).catch(() => {})
        sessionIdRef.current = null
      }
      xtermRef.current?.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      setInitState('idle')
    }
  }, [visible, workspacePath])

  // Bind I/O after terminal creation (separate effect to avoid re-creating on every render)
  useEffect(() => {
    if (!visible || !xtermRef.current || initState !== 'ready') return
    const term = xtermRef.current

    // Bind input: user typing → PTY
    const disposableData = term.onData((data) => {
      const id = sessionIdRef.current
      if (id) window.electronAPI.terminal.write(id, data)
    })

    // Bind output: PTY → terminal
    const unsubData = window.electronAPI.terminal.onData(({ id, data }) => {
      if (id === sessionIdRef.current) term.write(data)
    })

    const unsubExit = window.electronAPI.terminal.onExit(({ id, exitCode }) => {
      if (id === sessionIdRef.current) {
        term.writeln(`\r\n[进程已退出，退出码: ${exitCode ?? 'unknown'}]`)
        sessionIdRef.current = null
      }
    })

    return () => {
      disposableData.dispose()
      unsubData()
      unsubExit()
    }
  }, [visible, initState])

  // Resize observer: keep PTY size in sync with xterm dimensions
  useEffect(() => {
    if (!visible || !wrapperRef.current || !xtermRef.current || !fitAddonRef.current || initState !== 'ready') return

    const wrapper = wrapperRef.current
    const term = xtermRef.current
    const fitAddon = fitAddonRef.current

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        fitAddon.fit()
        const id = sessionIdRef.current
        if (id) {
          const { cols, rows } = term
          if (cols > 0 && rows > 0) {
            window.electronAPI.terminal.resize(id, cols, rows)
          }
        }
      }, 50)
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(wrapper)

    // also listen for window resize
    window.addEventListener('resize', handleResize)

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [visible, initState])

  // Switch shell
  const handleShellChange = useCallback((shellPath: string) => {
    const oldId = sessionIdRef.current
    if (oldId) {
      window.electronAPI.terminal.kill(oldId).catch(() => {})
    }
    setCurrentShell(shellPath)
    window.electronAPI.terminal.setDefaultShell(shellPath).catch(() => {})
    setPtyError(null)

    const term = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!term || !fitAddon) return

    window.electronAPI.terminal.create({ shell: shellPath, cwd: workspacePath, workspacePath }).then((res) => {
      sessionIdRef.current = res.id
      term.clear()
      fitAddon.fit()
      const { cols, rows } = term
      if (cols > 0 && rows > 0) {
        window.electronAPI.terminal.resize(res.id, cols, rows)
      }
      term.focus()
    }).catch((err) => {
      setPtyError(err?.message || '无法创建终端会话')
    })
  }, [workspacePath])

  if (!visible) return null

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col shrink-0"
      style={{
        height: 250,
        borderTop: position === 'bottom' ? '1px solid var(--na-border-subtle)' : 'none',
        borderBottom: position === 'top' ? '1px solid var(--na-border-subtle)' : 'none',
        background: '#1e1e1e',
        order: position === 'top' ? -1 : undefined,
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 h-8 shrink-0" style={{ background: '#2d2d2d' }}>
        <div className="flex items-center gap-2">
          <select
            value={currentShell}
            onChange={(e) => handleShellChange(e.target.value)}
            className="text-xs rounded px-1 py-0.5 border-none outline-none cursor-pointer"
            style={{ background: '#3c3c3c', color: '#ccc' }}
          >
            {shells.map((s) => (
              <option key={s.path} value={s.path}>{s.name}</option>
            ))}
          </select>
          {ptyError && (
            <span className="text-[11px]" style={{ color: '#ef4444' }}>{ptyError}</span>
          )}
          {initState !== 'ready' && initState !== 'idle' && (
            <span className="text-[11px]" style={{ color: '#888' }}>
              {initState === 'waiting_size' ? '等待布局...' : initState === 'opening' ? '初始化中...' : '创建会话...'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onTogglePosition} title="切换位置" className="p-1 rounded hover:bg-white/10 transition-colors">
            {position === 'bottom' ? (
              <ChevronUp className="w-3 h-3" style={{ color: '#888' }} />
            ) : (
              <ChevronDown className="w-3 h-3" style={{ color: '#888' }} />
            )}
          </button>
          <button onClick={onClose} title="关闭" className="p-1 rounded hover:bg-white/10 transition-colors">
            <X className="w-3 h-3" style={{ color: '#888' }} />
          </button>
        </div>
      </div>
      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0 relative" />
    </div>
  )
})

export default TerminalPanel
