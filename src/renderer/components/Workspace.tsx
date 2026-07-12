import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useWorkspace, type WorkspaceWindow } from '../state/workspace'
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
import { ConfirmDialog } from './ConfirmDialog'
import { cn } from '../lib/ui'
import { typeStyle } from '../lib/typography'
import type { CodexUserInput } from '@/shared/codex'
import { useOptionalTasks } from '../state/tasks'
import { BIND_WORKSPACE_WINDOW_THREAD_EVENT, chatWindowForExecutionContext, codexThreadIdForActiveWindow } from '../state/workspace-model'
import { resolveTaskExecutionContext, type TaskExecutionContext } from '../state/execution-context'
import { registerChatContextWorkspace, sendChatContextSafely } from '../state/chat-context-command'
import { handleTabListKeyDown } from '../lib/tab-navigation'
import { IconButton } from './ui/IconButton'

const TerminalWindow = lazy(() => import('./TerminalWindow').then((module) => ({ default: module.TerminalWindow })))

interface WorkspaceProps {
  browserSurfaceObscured?: boolean
}

export function Workspace({ browserSurfaceObscured = false }: WorkspaceProps) {
  const { windows, activeWindowId, openChat, openTerminal, openBrowser, updateBrowserState, closeWindow, setActiveWindow, bindWindowToTask, bindWindowToThread } = useWorkspace()
  const { repos, activeRepoId, setActiveRepo } = useRepos()
  const { openSession, closeThreadWindow, switchThread } = useCodexActions()
  const { getThreadForWindow } = useCodexWindows()
  const tasksApi = useOptionalTasks()
  const [terminalCloseTarget, setTerminalCloseTarget] = useState<{ windowId: string; termId: string } | null>(null)
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false })
  const tabStripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onBindWindowThread = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        windowId?: unknown
        threadId?: unknown
        projectId?: unknown
      } | undefined
      if (
        typeof detail?.windowId !== 'string'
        || typeof detail.threadId !== 'string'
        || (detail.projectId !== undefined && typeof detail.projectId !== 'string')
      ) return
      bindWindowToThread(detail.windowId, detail.threadId, detail.projectId)
    }
    window.addEventListener(BIND_WORKSPACE_WINDOW_THREAD_EVENT, onBindWindowThread)
    return () => window.removeEventListener(BIND_WORKSPACE_WINDOW_THREAD_EVENT, onBindWindowThread)
  }, [bindWindowToThread])

  useEffect(() => {
    switchThread(codexThreadIdForActiveWindow(windows, activeWindowId, tasksApi?.tasks))
  }, [activeWindowId, switchThread, tasksApi?.tasks, windows])

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
      const providedContext = (event as CustomEvent).detail?.context as TaskExecutionContext | undefined
      if (!session) return
      const targetRepo = repoPath ? repos.find((repo) => repo.path === repoPath) : null
      if (repoPath && !targetRepo) {
        console.error(`Cannot open Codex session because its repo is unavailable: ${repoPath}`)
        toast.error('That session\'s repo is no longer available.')
        return
      }
      const adoptSessionTask = async () => {
        if (!targetRepo) return { task: null, context: undefined }
        if (providedContext) {
          return {
            task: tasksApi?.tasks.find((candidate) => candidate.id === providedContext.taskId) ?? null,
            context: providedContext,
          }
        }
        const task = (await window.cranberri.tasks.adoptLocalThread({ projectId: targetRepo.id, threadId: session.id, archived })).task
        const snapshot = await window.cranberri.tasks.snapshot()
        const checkout = snapshot.checkouts.find((candidate) => candidate.id === task.checkoutId)
          ?? snapshot.managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
        const context = checkout ? {
          projectId: task.projectId,
          taskId: task.id,
          checkoutId: task.checkoutId,
          worktreeId: task.worktreeId,
          checkoutPath: 'canonicalPath' in checkout ? checkout.canonicalPath : checkout.path,
        } : undefined
        return { task, context }
      }
      const existingWindow = windows.find((item) => item.type === 'chat' && (
        item.threadId === session.id || (!item.threadId && getThreadForWindow(item.id) === session.id)
      ))
      if (existingWindow) {
        setActiveWindow(existingWindow.id)
        if (targetRepo && targetRepo.id !== activeRepoId) void setActiveRepo(targetRepo.id)
        const boundTask = tasksApi?.tasks.find((task) => (
          task.id === existingWindow.taskId
          && task.threadId === session.id
          && task.checkoutId === existingWindow.checkoutId
        ))
        if (!boundTask && targetRepo && !providedContext) {
          void adoptSessionTask().then(async ({ context }) => {
            if (context) bindWindowToTask(existingWindow.id, context)
            await tasksApi?.refresh()
          }).catch((error) => console.error('Failed to repair existing session task binding:', error))
        }
        return
      }
      const windowId = `session-${session.id}`
      const open = async () => {
        const { task, context } = await adoptSessionTask()
        const thread = await openSession(windowId, session, archived, targetRepo ?? undefined)
        openChat(windowId, thread.title, targetRepo?.id ?? activeRepoId, context, task?.location)
        bindWindowToThread(windowId, thread.id, targetRepo?.id ?? activeRepoId)
        if (context) bindWindowToTask(windowId, context)
        await tasksApi?.refresh()
        if (targetRepo && targetRepo.id !== activeRepoId) return setActiveRepo(targetRepo.id)
        return undefined
      }
      void open().catch((error) => console.error('Failed to open Codex session:', error))
    }
    window.addEventListener('cranberri:open-codex-session', onOpenSession)
    return () => window.removeEventListener('cranberri:open-codex-session', onOpenSession)
  }, [activeRepoId, bindWindowToTask, bindWindowToThread, getThreadForWindow, openChat, openSession, repos, setActiveRepo, setActiveWindow, tasksApi, windows])

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

  const chooseChatContextTarget = useCallback(() => {
    const existingChat = chatWindowForExecutionContext(windows, activeWindowId)
    const targetWindowId = existingChat?.id ?? openChat()
    setActiveWindow(targetWindowId)
    return targetWindowId
  }, [activeWindowId, openChat, setActiveWindow, windows])

  useEffect(() => {
    return registerChatContextWorkspace(chooseChatContextTarget)
  }, [chooseChatContextTarget])

  const sendContextToChat = useCallback((text: string, inputParts?: CodexUserInput[], attachmentPaths?: string[]) => {
    sendChatContextSafely({ text, inputParts, attachmentPaths })
  }, [])

  const checkoutPathForWindow = useCallback((workspaceWindow: WorkspaceWindow): string | null => {
    if (!tasksApi || tasksApi.loading) return null
    const resolution = resolveTaskExecutionContext(workspaceWindow, tasksApi)
    return resolution.status === 'available' ? resolution.context.checkoutPath : null
  }, [tasksApi])

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'w' || !activeWindowId) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]')) return
      event.preventDefault()
      closeWorkspaceWindow(activeWindowId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeWindowId, closeWorkspaceWindow])

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
            onKeyDown={handleTabListKeyDown}
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
                    tabIndex={active ? 0 : -1}
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
                    tabIndex={-1}
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
          <IconButton
            type="button"
            onClick={() => openTerminal()}
            label="New terminal"
          >
            <SquareTerminal className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            type="button"
            onClick={() => openBrowser()}
            label="New browser"
          >
            <Globe className="h-3.5 w-3.5" />
          </IconButton>
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
                <TerminalWindow id={win.id} repoPath={checkoutPathForWindow(win)} taskId={win.taskId} onSendToChat={sendContextToChat} />
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
