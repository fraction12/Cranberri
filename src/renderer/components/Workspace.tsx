import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useWorkspace } from '../state/workspace'
import { useCodex } from '../state/codex'
import { useRepos } from '../state/repos'
import { ChatWindow } from './ChatWindow'
import { BrowserWindow as BrowserPane } from './BrowserWindow'
import { Plus, MessageSquare, Terminal, X, Globe } from 'lucide-react'
import {
  CLOSE_PROCESS_TERMINAL_EVENT,
  OPEN_PROCESS_TERMINAL_EVENT,
  closeableTerminalWorkspaceWindowIdFromEvent,
  openableTerminalWorkspaceWindowId,
} from './process-terminal-events'
import { OPEN_PROCESS_BROWSER_EVENT, processBrowserDetailFromEvent } from './process-browser-events'
import { OPEN_TERMINAL_LINK_BROWSER_EVENT, terminalLinkBrowserDetailFromEvent } from './terminal-link-events'
import {
  SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT,
  createInsertChatContextEvent,
  sendChatContextDetailFromEvent,
} from './chat/chat-context-events'
import { ConfirmDialog } from './ConfirmDialog'
import type { CodexUserInput } from '@/shared/codex'

const TerminalWindow = lazy(() => import('./TerminalWindow').then((module) => ({ default: module.TerminalWindow })))

export function Workspace() {
  const { windows, activeWindowId, activeRepoPath, openChat, openTerminal, openBrowser, updateBrowserState, closeWindow, setActiveWindow } = useWorkspace()
  const { repos, activeRepoId, setActiveRepo } = useRepos()
  const { openSession, closeThreadWindow } = useCodex()
  const [terminalCloseTarget, setTerminalCloseTarget] = useState<{ windowId: string; termId: string } | null>(null)

  useEffect(() => {
    const onOpenSession = (event: Event) => {
      const session = (event as CustomEvent).detail?.session
      const repoPath = (event as CustomEvent).detail?.repoPath
      const archived = Boolean((event as CustomEvent).detail?.archived)
      if (!session) return
      const targetRepo = repoPath ? repos.find((repo) => repo.path === repoPath) : null
      const windowId = `session-${session.id}`
      openSession(windowId, session, archived)
        .then((thread) => {
          openChat(windowId, thread.title, targetRepo?.id ?? activeRepoId)
          if (targetRepo && targetRepo.id !== activeRepoId) return setActiveRepo(targetRepo.id)
          return undefined
        })
        .catch((error) => console.error('Failed to open Codex session:', error))
    }
    window.addEventListener('cranberri:open-codex-session', onOpenSession)
    return () => window.removeEventListener('cranberri:open-codex-session', onOpenSession)
  }, [activeRepoId, openChat, openSession, repos, setActiveRepo])

  useEffect(() => {
    const onOpenProcessTerminal = (event: Event) => {
      const processInfo = (event as CustomEvent).detail?.process
      const terminalWindowId = openableTerminalWorkspaceWindowId(processInfo)
      if (terminalWindowId) {
        openTerminal(terminalWindowId, 'Terminal')
        return
      }
      if (processInfo?.cwd) {
        openTerminal(undefined, `Terminal · pid ${processInfo.pid ?? 'unknown'}`)
      }
    }
    window.addEventListener(OPEN_PROCESS_TERMINAL_EVENT, onOpenProcessTerminal)
    return () => window.removeEventListener(OPEN_PROCESS_TERMINAL_EVENT, onOpenProcessTerminal)
  }, [openTerminal])

  useEffect(() => {
    const onOpenProcessBrowser = (event: Event) => {
      const detail = processBrowserDetailFromEvent(event)
      if (!detail) return
      openBrowser({
        id: detail.windowId,
        title: 'Browser',
        url: detail.url,
        processId: detail.process.id,
      })
    }
    window.addEventListener(OPEN_PROCESS_BROWSER_EVENT, onOpenProcessBrowser)
    return () => window.removeEventListener(OPEN_PROCESS_BROWSER_EVENT, onOpenProcessBrowser)
  }, [openBrowser])

  useEffect(() => {
    const onOpenTerminalLinkBrowser = (event: Event) => {
      const detail = terminalLinkBrowserDetailFromEvent(event)
      if (!detail) return
      openBrowser({
        id: detail.windowId,
        title: detail.title,
        url: detail.url,
      })
    }
    window.addEventListener(OPEN_TERMINAL_LINK_BROWSER_EVENT, onOpenTerminalLinkBrowser)
    return () => window.removeEventListener(OPEN_TERMINAL_LINK_BROWSER_EVENT, onOpenTerminalLinkBrowser)
  }, [openBrowser])

  useEffect(() => {
    const onCloseProcessTerminal = (event: Event) => {
      const terminalWindowId = closeableTerminalWorkspaceWindowIdFromEvent(event)
      if (terminalWindowId) closeWindow(terminalWindowId)
    }
    window.addEventListener(CLOSE_PROCESS_TERMINAL_EVENT, onCloseProcessTerminal)
    return () => window.removeEventListener(CLOSE_PROCESS_TERMINAL_EVENT, onCloseProcessTerminal)
  }, [closeWindow])

  const sendContextToChat = useCallback((text: string, inputParts?: CodexUserInput[], attachmentPaths?: string[]) => {
    const activeChat = windows.find((win) => win.id === activeWindowId && win.type === 'chat')
    const existingChat = activeChat ?? windows.find((win) => win.type === 'chat')
    const targetWindowId = existingChat?.id ?? openChat()
    setActiveWindow(targetWindowId)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(createInsertChatContextEvent({ windowId: targetWindowId, text, inputParts, attachmentPaths }))
      })
    })
  }, [activeWindowId, openChat, setActiveWindow, windows])

  useEffect(() => {
    const onSendContextToActiveChat = (event: Event) => {
      const detail = sendChatContextDetailFromEvent(event)
      if (!detail) return
      sendContextToChat(detail.text, detail.inputParts, detail.attachmentPaths)
    }
    window.addEventListener(SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT, onSendContextToActiveChat)
    return () => window.removeEventListener(SEND_CHAT_CONTEXT_TO_ACTIVE_CHAT_EVENT, onSendContextToActiveChat)
  }, [sendContextToChat])

  const closeWorkspaceWindow = useCallback((windowId: string) => {
    const win = windows.find((item) => item.id === windowId)
    if (!win) return
    if (win.type === 'chat') {
      closeThreadWindow(win.id)
      closeWindow(win.id)
      return
    }
    if (win.type === 'browser') {
      window.cranberri.browser.destroy(win.id).catch(() => undefined)
      closeWindow(win.id)
      return
    }
    if (win.type === 'terminal') {
      setTerminalCloseTarget({ windowId: win.id, termId: `terminal-${win.id}` })
    }
  }, [closeThreadWindow, closeWindow, windows])

  const confirmTerminalClose = useCallback(() => {
    if (!terminalCloseTarget) return
    window.cranberri.terminal.kill(terminalCloseTarget.termId)
    closeWindow(terminalCloseTarget.windowId)
    setTerminalCloseTarget(null)
  }, [closeWindow, terminalCloseTarget])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="h-9 flex items-center border-b border-app-border bg-app-surface shrink-0 px-2 gap-1">
        {windows.map((win) => (
          <button
            key={win.id}
            type="button"
            aria-label={`Switch to ${win.title}`}
            onClick={() => setActiveWindow(win.id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs max-w-[160px] ${
              activeWindowId === win.id
                ? 'bg-app-surface-2 text-app-text'
                : 'text-app-text-muted hover:bg-app-surface-2/50'
            }`}
          >
            {win.type === 'chat' ? <MessageSquare className="w-3.5 h-3.5" /> : win.type === 'terminal' ? <Terminal className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
            <span className="truncate">{win.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeWorkspaceWindow(win.id)
              }}
              className="ml-1 p-0.5 rounded hover:bg-app-border"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openChat()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => openTerminal()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <Terminal className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => openBrowser()}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-app-text-muted hover:text-app-text hover:bg-app-surface-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <Globe className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {windows.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-app-text-muted">
            Open a chat or terminal window.
          </div>
        )}
        {windows.map((win) => (
          <div
            key={win.id}
            className={`absolute inset-0 ${activeWindowId === win.id ? 'block' : 'hidden'}`}
          >
            {win.type === 'chat' ? (
              <ChatWindow id={win.id} />
            ) : win.type === 'terminal' ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-app-text-muted">Loading terminal...</div>}>
                <TerminalWindow id={win.id} repoPath={activeRepoPath} onSendToChat={sendContextToChat} />
              </Suspense>
            ) : (
              <BrowserPane
                windowState={win}
                active={activeWindowId === win.id}
                onPageState={(state) => updateBrowserState(win.id, { url: state.url, title: state.title || 'Browser' })}
                onViewportModeChange={(viewportMode) => updateBrowserState(win.id, { viewportMode })}
                onSendToChat={sendContextToChat}
              />
            )}
          </div>
        ))}
      </div>
      {terminalCloseTarget && (
        <ConfirmDialog
          title="Close terminal"
          description={`Close terminal ${terminalCloseTarget.termId}? Any running process in it will be terminated.`}
          confirmLabel="Close"
          danger
          onCancel={() => setTerminalCloseTarget(null)}
          onConfirm={confirmTerminalClose}
        />
      )}
    </div>
  )
}
