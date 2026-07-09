import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, ChevronUp, MessageSquare, Search, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { cn, iconButton } from '../lib/ui'
import { createOpenTerminalLinkBrowserEvent } from './terminal-link-events'
import { TERMINAL_WINDOW_COMMAND_EVENT, terminalWindowCommandFromEvent } from './terminal-window-command-events'
import { terminalBufferChatContext } from './terminal-chat-context'
import { terminalClipboardText } from './terminal-buffer'
import { terminalTheme } from './terminal-theme'
import { useAppearance } from '../state/appearance-context'
import { useSettings } from '../state/settings'

interface TerminalWindowProps {
  id: string
  repoPath: string | null
  onSendToChat: (text: string) => void
}

function readTerminalBuffer(term: XTerm): string {
  const activeBuffer = term.buffer.active
  const lines: string[] = []
  for (let index = 0; index < activeBuffer.length; index += 1) {
    const text = activeBuffer.getLine(index)?.translateToString(true).trimEnd()
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

export function TerminalWindow({ id, repoPath, onSendToChat }: TerminalWindowProps) {
  const { settings } = useSettings()
  const { theme } = useAppearance()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const fitDebounceRef = useRef(0)
  const mountedRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const visualSettingsRef = useRef({ theme, fontSize: settings.terminal.fontSize })
  visualSettingsRef.current = { theme, fontSize: settings.terminal.fontSize }

  const termId = `terminal-${id}`

  useEffect(() => {
    if (!repoPath || !containerRef.current || termRef.current) return

    const container = containerRef.current
    const visuals = visualSettingsRef.current
    const t = new XTerm({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
      fontSize: visuals.fontSize,
      allowProposedApi: true,
      scrollback: 10000,
      theme: terminalTheme(visuals.theme),
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    const clipboard = new ClipboardAddon()
    const webLinks = new WebLinksAddon((event, uri) => {
      event.preventDefault()
      const browserEvent = createOpenTerminalLinkBrowserEvent(uri)
      if (browserEvent) {
        window.dispatchEvent(browserEvent)
        return
      }
      window.cranberri.openExternal(uri).catch((error) => console.error('Failed to open terminal link:', error))
    })
    t.loadAddon(fit)
    t.loadAddon(search)
    t.loadAddon(clipboard)
    t.loadAddon(webLinks)
    t.open(container)

    termRef.current = t
    fitRef.current = fit
    searchRef.current = search
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
      window.cranberri.terminal.create(termId, repoPath, cols, rows).then((result) => {
        if (result.buffer && termRef.current) termRef.current.write(result.buffer)
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
      searchRef.current = null
      setReady(false)
    }
  }, [id, repoPath, termId])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(theme)
    term.options.fontSize = settings.terminal.fontSize
    const frame = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // xterm can throw while its pane is collapsed.
      }
      if (term.cols > 0 && term.rows > 0) window.cranberri.terminal.resize(termId, term.cols, term.rows)
    })
    return () => cancelAnimationFrame(frame)
  }, [settings.terminal.fontSize, termId, theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isVisible = Boolean(containerRef.current?.offsetParent)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && termRef.current && isVisible) {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        termRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchOpen])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const runSearch = useCallback((direction: 'next' | 'previous' = 'next') => {
    if (!searchTerm.trim()) return
    if (direction === 'previous') searchRef.current?.findPrevious(searchTerm)
    else searchRef.current?.findNext(searchTerm)
  }, [searchTerm])

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = terminalWindowCommandFromEvent(event)
      if (!detail || detail.windowId !== id) return
      if (detail.command === 'search') {
        setSearchOpen(true)
        return
      }
      if (detail.command === 'search-next') {
        setSearchOpen(true)
        runSearch('next')
        return
      }
      if (detail.command === 'search-previous') {
        setSearchOpen(true)
        runSearch('previous')
        return
      }
      if (detail.command === 'search-close') {
        setSearchOpen(false)
        termRef.current?.focus()
        return
      }
      if (detail.command === 'copy-buffer') {
        const term = termRef.current
        if (!term) return
        const renderedBuffer = readTerminalBuffer(term)
        window.cranberri.terminal.snapshot(termId)
          .then((snapshot) => navigator.clipboard.writeText(terminalClipboardText(renderedBuffer, snapshot.buffer)))
          .catch((error) => {
            console.error('Failed to copy terminal buffer:', error)
            return navigator.clipboard.writeText(renderedBuffer)
          })
          .catch((error) => console.error('Failed to write terminal buffer clipboard:', error))
        term.focus()
        return
      }
      termRef.current?.clear()
      window.cranberri.terminal.clear(termId).catch((error) => console.error('Failed to clear terminal buffer:', error))
      termRef.current?.focus()
    }
    window.addEventListener(TERMINAL_WINDOW_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(TERMINAL_WINDOW_COMMAND_EVENT, onCommand)
  }, [id, runSearch, termId])

  const sendTerminalContextToChat = () => {
    const term = termRef.current
    if (!term) return
    onSendToChat(terminalBufferChatContext({
      terminalId: termId,
      repoPath,
      text: readTerminalBuffer(term),
    }))
  }

  if (!repoPath) {
    return <div className="flex items-center justify-center h-full text-sm text-app-text-muted">Select a repo to use the terminal.</div>
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-app-border bg-app-surface-2 shrink-0 text-xs text-app-text-muted">
        <span className="truncate">{repoPath}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(iconButton(), 'h-6 w-6')}
            title="Send terminal context to chat"
            aria-label="Send terminal context to chat"
            onClick={sendTerminalContextToChat}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(iconButton({ tone: searchOpen ? 'active' : 'neutral' }), 'h-6 w-6')}
            title="Search terminal"
            aria-label="Search terminal"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          {ready && <span className="text-app-success">●</span>}
        </div>
      </div>
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-app-border bg-app-surface px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-app-text-muted" />
          <input
            ref={searchInputRef}
            autoFocus
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              if (event.target.value.trim()) searchRef.current?.findNext(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runSearch(event.shiftKey ? 'previous' : 'next')
              }
            }}
            placeholder="Search terminal"
            className="h-7 min-w-0 flex-1 rounded-md border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none placeholder:text-app-text-muted focus:border-app-accent"
          />
          <button
            type="button"
            className={cn(iconButton(), 'h-6 w-6')}
            title="Previous terminal search result"
            aria-label="Previous terminal search result"
            disabled={!searchTerm.trim()}
            onClick={() => runSearch('previous')}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(iconButton(), 'h-6 w-6')}
            title="Next terminal search result"
            aria-label="Next terminal search result"
            disabled={!searchTerm.trim()}
            onClick={() => runSearch('next')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(iconButton(), 'h-6 w-6')}
            title="Close terminal search"
            aria-label="Close terminal search"
            onClick={() => {
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-app-bg">
        <div ref={containerRef} className="absolute inset-0 w-full h-full p-2" />
      </div>
    </div>
  )
}
