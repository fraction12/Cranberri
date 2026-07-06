import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useRepos } from '../state/repos'

export function TerminalWindow({ id }: { id: string }) {
  const { activeRepo } = useRepos()
  const activeRepoPath = activeRepo?.path
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const fitDebounceRef = useRef(0)
  const mountedRef = useRef(false)
  const [ready, setReady] = useState(false)

  const termId = `terminal-${id}`

  useEffect(() => {
    if (!activeRepoPath || !containerRef.current || termRef.current) return

    const container = containerRef.current
    const t = new XTerm({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: '#0f0f11',
        foreground: '#fafafa',
        cursor: '#a1a1aa',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#27272a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    })

    const fit = new FitAddon()
    t.loadAddon(fit)
    t.open(container)

    termRef.current = t
    fitRef.current = fit
    mountedRef.current = true

    const fitAndResize = () => {
      if (!termRef.current || !fitRef.current || !mountedRef.current) return
      try {
        fitRef.current.fit()
      } catch {
        // xterm can throw if the container has zero size
      }
      const { cols, rows } = termRef.current
      if (cols > 0 && rows > 0) {
        window.cranberri.terminal.resize(termId, cols, rows)
      }
    }

    const onData = (data: string) => {
      window.cranberri.terminal.write(termId, data)
    }
    t.onData(onData)

    const unsubData = window.cranberri.terminal.onData((payload) => {
      if (payload.id === termId && termRef.current) {
        termRef.current.write(payload.data)
      }
    })

    const unsubExit = window.cranberri.terminal.onExit((payload) => {
      if (payload.id === termId && termRef.current) {
        termRef.current.writeln(`\r\n[process exited ${payload.exitCode}${payload.signal ? ` signal ${payload.signal}` : ''}]`)
      }
    })

    // Wait one paint so the container has real dimensions, then fit + create pty.
    const initFrame = requestAnimationFrame(() => {
      fitAndResize()
      const cols = t.cols > 0 ? t.cols : 100
      const rows = t.rows > 0 ? t.rows : 30
      window.cranberri.terminal.create(termId, activeRepoPath, cols, rows).then(() => {
        setReady(true)
        // Fit again after shell startup; cheap safety net.
        requestAnimationFrame(fitAndResize)
      })
    })

    roRef.current = new ResizeObserver(() => {
      // Debounce slightly; xterm's fit is fast but resize storms happen on drag.
      window.cancelAnimationFrame?.(fitDebounceRef.current)
      fitDebounceRef.current = requestAnimationFrame(fitAndResize)
    })
    roRef.current.observe(container)

    // Focus terminal when container is clicked.
    const onClick = () => t.focus()
    container.addEventListener('click', onClick)

    return () => {
      mountedRef.current = false
      window.cancelAnimationFrame?.(initFrame)
      window.cancelAnimationFrame?.(fitDebounceRef.current)
      container.removeEventListener('click', onClick)
      unsubData()
      unsubExit()
      roRef.current?.disconnect()
      roRef.current = null
      t.dispose()
      termRef.current = null
      fitRef.current = null
      setReady(false)
    }
  }, [activeRepoPath, id, termId])

  if (!activeRepoPath) {
    return <div className="flex items-center justify-center h-full text-sm text-app-text-muted">Select a repo to use the terminal.</div>
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-app-border bg-app-surface-2 shrink-0 text-xs text-app-text-muted">
        <span className="truncate">{activeRepoPath}</span>
        {ready && <span className="text-app-accent">●</span>}
      </div>
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-[#0f0f11]">
        <div ref={containerRef} className="absolute inset-0 w-full h-full p-2" />
      </div>
    </div>
  )
}
