import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspace } from '../state/workspace'
import { useCodexActions, useCodexWindows } from '../state/codex'
import { useRepos } from '../state/repos'
import { ChatWindow } from './ChatWindow'
import { BrowserWindow as BrowserPane } from './BrowserWindow'
import { ChevronLeft, ChevronRight, Globe, MessageSquare, SquareTerminal, Terminal, X } from 'lucide-react'
import { NewSessionMenu } from './chat/NewSessionMenu'
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
import { cn, iconButton } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import type { CodexUserInput } from '@/shared/codex'
import { useOptionalTasks } from '../state/tasks'

const TerminalWindow = lazy(() => import('./TerminalWindow').then((module) => ({ default: module.TerminalWindow })))

interface WorkspaceProps {
  browserSurfaceObscured?: boolean
}

export function Workspace({ browserSurfaceObscured = false }: WorkspaceProps) {
  const { windows, activeWindowId, activeRepoPath, openChat, openTerminal, openBrowser, updateBrowserState, closeWindow, setActiveWindow, bindWindowToTask } = useWorkspace()
  const { repos, activeRepoId, setActiveRepo } = useRepos()
  const { openSession, closeThreadWindow } = useCodexActions()
  const { getThreadForWindow } = useCodexWindows()
  const tasksApi = useOptionalTasks()
  const [terminalCloseTarget, setTerminalCloseTarget] = useState<{ windowId: string; termId: string } | null>(null)
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false })
  const tabStripRef = useRef<HTMLDivElement>(null)

  const syncTabOverflow = useCallback(() => {
    const strip = tabStripRef.current
    if (!strip) return
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth)
    setTabOverflow({
      left: strip.scrollLeft > 1,
      right: strip.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  const scrollTabs = useCallback((direction: -1 | 1) => {
    tabStripRef.current?.scrollBy({ left: direction * 180, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const strip = tabStripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(syncTabOverflow)
    observer.observe(strip)
    const frame = requestAnimationFrame(syncTabOverflow)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [syncTabOverflow, windows.length])

  useEffect(() => {
    const strip = tabStripRef.current
    const activeTab = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!strip || !activeTab) return
    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    const frame = requestAnimationFrame(syncTabOverflow)
    return () => cancelAnimationFrame(frame)
  }, [activeWindowId, syncTabOverflow])

  useEffect(() => {
    const onOpenSession = (event: Event) => {
      const session = (event as CustomEvent).detail?.session
      const repoPath = (event as CustomEvent).detail?.repoPath
      const archived = Boolean((event as CustomEvent).detail?.archived)
      if (!session) return
      const targetRepo = repoPath ? repos.find((repo) => repo.path === repoPath) : null
      if (repoPath && !targetRepo) {
        console.error(`Cannot open Codex session because its repo is unavailable: ${repoPath}`)
        toast.error('That session\'s repo is no longer available.')
        return
      }
      const existingWindow = windows.find((item) => item.type === 'chat' && getThreadForWindow(item.id) === session.id)
      if (existingWindow) {
        setActiveWindow(existingWindow.id)
        if (targetRepo && targetRepo.id !== activeRepoId) void setActiveRepo(targetRepo.id)
        return
      }
      const windowId = `session-${session.id}`
      const open = async () => {
        const taskResult = targetRepo
          ? await window.cranberri.tasks.adoptLocalThread({ projectId: targetRepo.id, threadId: session.id, archived })
          : null
        const snapshot = taskResult ? await window.cranberri.tasks.snapshot() : null
        const task = taskResult?.task
        const checkout = task && snapshot
          ? snapshot.checkouts.find((candidate) => candidate.id === task.checkoutId)
            ?? snapshot.managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
          : null
        const context = task && checkout ? {
          projectId: task.projectId,
          taskId: task.id,
          checkoutId: task.checkoutId,
          worktreeId: task.worktreeId,
          checkoutPath: 'canonicalPath' in checkout ? checkout.canonicalPath : checkout.path,
        } : undefined
        const thread = await openSession(windowId, session, archived, targetRepo ?? undefined)
        openChat(windowId, thread.title, targetRepo?.id ?? activeRepoId, context, task?.location)
        if (context) bindWindowToTask(windowId, context)
        await tasksApi?.refresh()
        if (targetRepo && targetRepo.id !== activeRepoId) return setActiveRepo(targetRepo.id)
        return undefined
      }
      void open().catch((error) => console.error('Failed to open Codex session:', error))
    }
    window.addEventListener('cranberri:open-codex-session', onOpenSession)
    return () => window.removeEventListener('cranberri:open-codex-session', onOpenSession)
  }, [activeRepoId, bindWindowToTask, getThreadForWindow, openChat, openSession, repos, setActiveRepo, setActiveWindow, tasksApi, windows])

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
      <div className="relative z-10 flex h-9 shrink-0 items-center gap-1 bg-app-surface px-1.5 shadow-sm">
        <div className="relative min-w-0 flex-1">
          <div
            ref={tabStripRef}
            className="workspace-tab-strip flex h-full min-w-0 items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Workspace tabs"
            onScroll={syncTabOverflow}
          >
            {windows.map((win) => {
              const active = activeWindowId === win.id
              return (
                <div
                  key={win.id}
                  className={cn(
                    'group flex h-7 max-w-[176px] shrink-0 items-center rounded-md transition-colors duration-fast ease-standard',
                    typeStyle({ role: 'control', tone: active ? 'primary' : 'secondary' }),
                    active ? 'bg-app-surface-2' : 'hover:bg-app-surface-2/60 hover:text-app-text',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={`Switch to ${win.title}`}
                    onClick={() => setActiveWindow(win.id)}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 pr-1"
                  >
                    {win.type === 'chat' ? <MessageSquare className="h-3.5 w-3.5 shrink-0" /> : win.type === 'terminal' ? <Terminal className="h-3.5 w-3.5 shrink-0" /> : <Globe className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{win.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${win.title}`}
                    onClick={() => closeWorkspaceWindow(win.id)}
                    className={cn(
                      'mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-app-text-subtle transition-opacity hover:bg-app-border/70 hover:text-app-text',
                      active ? 'opacity-80' : 'opacity-0 group-hover:opacity-80 focus-visible:opacity-100',
                    )}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
          {tabOverflow.left && (
            <button
              type="button"
              onClick={() => scrollTabs(-1)}
              className="absolute inset-y-0 left-0 flex w-7 items-center justify-center bg-app-surface text-app-text-muted shadow-[5px_0_8px_var(--app-surface)] hover:text-app-text"
              title="Scroll tabs left"
              aria-label="Scroll tabs left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {tabOverflow.right && (
            <button
              type="button"
              onClick={() => scrollTabs(1)}
              className="absolute inset-y-0 right-0 flex w-7 items-center justify-center bg-app-surface text-app-text-muted shadow-[-5px_0_8px_var(--app-surface)] hover:text-app-text"
              title="Scroll tabs right"
              aria-label="Scroll tabs right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          {activeRepoId && <NewSessionMenu
            onLocal={() => openChat(undefined, 'New local session', activeRepoId, undefined, 'local')}
            onWorktree={() => openChat(undefined, 'New worktree session', activeRepoId, undefined, 'worktree')}
          />}
          <button
            type="button"
            onClick={() => openTerminal()}
            className={iconButton()}
            title="New terminal"
            aria-label="New terminal"
          >
            <SquareTerminal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openBrowser()}
            className={iconButton()}
            title="New browser"
            aria-label="New browser"
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {windows.length === 0 && (
          <div className={cn('flex h-full items-center justify-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
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
              <Suspense fallback={<div className={cn('flex h-full items-center justify-center', typeStyle({ role: 'status', tone: 'secondary' }))}>Loading terminal...</div>}>
                <TerminalWindow id={win.id} repoPath={activeRepoPath} taskId={win.taskId} onSendToChat={sendContextToChat} />
              </Suspense>
            ) : (
              <BrowserPane
                windowState={win}
                active={activeWindowId === win.id}
                obscured={browserSurfaceObscured}
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
