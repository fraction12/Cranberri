import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { CodexMessage, CodexEvent, CodexSessionSummary, CodexSessionThread, CodexThread, CodexTurnSettings, CodexUserInput } from '@/shared/codex'
import { useRepos } from './repos'
import { applyCodexSendFailure } from './codex-send-failure'
import { applyStreamingMessageUpdates, streamingMessageKey, type StreamingMessageUpdate } from './codex-streaming'
import { clearToolActivityEvents, recordToolActivityEvent } from './tools'

interface CodexThreadStateApi {
  threads: CodexThread[]
  activeThread: CodexThread | null
  getThread: (threadId: string) => CodexThread | undefined
}

interface CodexWindowStateApi {
  activeThreadId: string | null
  openThreadIds: string[]
  getThreadForWindow: (windowId: string) => string | undefined
}

interface CodexActionsApi {
  getThreadSnapshot: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string, settings?: CodexTurnSettings, initialInput?: CodexUserInput[]) => Promise<CodexThread>
  sendMessage: (threadId: string, content: string, input?: CodexUserInput[], settings?: CodexTurnSettings) => Promise<void>
  compactThread: (threadId: string) => Promise<void>
  approve: (threadId: string, approvalId: string, action?: 'approve' | 'deny') => Promise<void>
  abort: (threadId: string) => Promise<void>
  switchThread: (threadId: string | null) => void
  closeThreadWindow: (windowId: string) => void
  openSession: (
    windowId: string,
    session: CodexSessionSummary,
    archived?: boolean,
    repo?: { id: string; path: string },
  ) => Promise<CodexThread>
  restoreSessionWindow: (windowId: string, threadId: string) => Promise<CodexThread>
  archiveSession: (threadId: string) => Promise<void>
  unarchiveSession: (threadId: string) => Promise<void>
  deleteSession: (threadId: string) => Promise<void>
  renameSession: (threadId: string, name: string) => Promise<void>
}

type CodexApi = CodexThreadStateApi & CodexWindowStateApi & CodexActionsApi

const CodexThreadStateContext = createContext<CodexThreadStateApi | null>(null)
const CodexWindowStateContext = createContext<CodexWindowStateApi | null>(null)
const CodexActionsContext = createContext<CodexActionsApi | null>(null)

function itemText(item: { content?: Array<{ text?: string }> }): string {
  return item.content?.map((part) => part.text).filter(Boolean).join('\n') ?? ''
}

function agentMessageRole(phase: string | null | undefined): 'assistant' | 'reasoning' {
  // Only explicit commentary / reasoning phases belong in the collapsible reasoning group.
  // Everything else — including missing, unknown, or final_answer phases — renders as a
  // first-class assistant message so the final response is never hidden.
  if (phase === 'commentary' || phase === 'reasoning') return 'reasoning'
  return 'assistant'
}

function threadToMessages(thread: CodexSessionThread): CodexMessage[] {
  const messages: CodexMessage[] = []
  for (const turn of thread.turns) {
    const timestamp = (turn.startedAt ?? thread.updatedAt ?? Date.now() / 1000) * 1000
    for (const item of turn.items ?? []) {
      if (item.type === 'userMessage') {
        const content = itemText(item)
        if (content) messages.push({ id: item.id ?? crypto.randomUUID(), role: 'user', content, timestamp })
      } else if (item.type === 'agentMessage' && item.text) {
        messages.push({
          id: item.id ?? crypto.randomUUID(),
          role: agentMessageRole(item.phase),
          content: item.text,
          timestamp,
        })
      } else if (item.type === 'reasoning') {
        const content = [...(item.summary ?? []), ...(Array.isArray(item.content) ? item.content as unknown as string[] : [])].filter(Boolean).join('\n')
        if (content) messages.push({ id: item.id ?? crypto.randomUUID(), role: 'reasoning', content, timestamp })
      } else if (item.type === 'contextCompaction' || item.type === 'compaction') {
        const completed = Boolean(turn.completedAt) || turn.status === 'completed'
        messages.push({
          id: item.id ?? crypto.randomUUID(),
          role: 'compact',
          content: completed ? 'Context compacted' : 'Compacting context',
          timestamp: ((completed ? turn.completedAt : turn.startedAt) ?? thread.updatedAt ?? Date.now() / 1000) * 1000,
          pending: !completed,
        })
      }
    }
  }
  return messages
}

function hydrateThread(session: CodexSessionThread, repoId: string): CodexThread {
  const lastTurn = [...session.turns].reverse().find((turn) => turn.durationMs)
  return {
    id: session.id,
    title: session.title,
    repoId,
    messages: threadToMessages(session),
    pendingApprovals: [],
    isRunning: false,
    lastRunDurationMs: lastTurn?.durationMs ?? undefined,
    contextUsage: undefined,
  }
}

function logRendererTelemetry(type: string, payload: unknown): void {
  window.cranberri.telemetry.log('renderer', type, payload).catch((err) => {
    console.warn('Failed to write telemetry:', err)
  })
}

export function CodexProvider({ children }: { children: React.ReactNode }) {
  const { activeRepo } = useRepos()
  const [threads, setThreads] = useState<CodexThread[]>([])
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const [windowToThread, setWindowToThread] = useState<Record<string, string>>({})
  const streamingBuffersRef = useRef<Record<string, string>>({})
  const pendingStreamingUpdatesRef = useRef<Map<string, StreamingMessageUpdate>>(new Map())
  const streamingFrameRef = useRef<number | null>(null)
  const pendingThreadTitlesRef = useRef<Record<string, string>>({})
  const previousActiveThreadIdRef = useRef<string | null>(null)

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null
  const openThreadIds = useMemo(() => [...new Set(Object.values(windowToThread))], [windowToThread])
  const getThread = useCallback((threadId: string) => threads.find((t) => t.id === threadId), [threads])
  const getThreadSnapshot = useCallback((threadId: string) => threadsRef.current.find((thread) => thread.id === threadId), [])

  useEffect(() => {
    const previous = previousActiveThreadIdRef.current
    if (previous && previous !== activeThreadId) clearToolActivityEvents(previous)
    previousActiveThreadIdRef.current = activeThreadId
  }, [activeThreadId])

  useEffect(() => () => clearToolActivityEvents(), [])

  const flushStreamingMessages = useCallback(() => {
    streamingFrameRef.current = null
    const updates = [...pendingStreamingUpdatesRef.current.values()]
    pendingStreamingUpdatesRef.current.clear()
    if (updates.length === 0) return

    setThreads((current) => applyStreamingMessageUpdates(current, updates))
    for (const update of updates) {
      if (!update.pending) delete streamingBuffersRef.current[streamingMessageKey(update.threadId, update.itemId)]
    }
  }, [])

  const flushStreamingMessagesNow = useCallback(() => {
    if (streamingFrameRef.current !== null) {
      cancelAnimationFrame(streamingFrameRef.current)
      streamingFrameRef.current = null
    }
    flushStreamingMessages()
  }, [flushStreamingMessages])

  const queueStreamingMessage = useCallback((
    threadId: string,
    itemId: string,
    role: 'assistant' | 'reasoning',
    pending: boolean,
    flushNow = false,
  ) => {
    const key = streamingMessageKey(threadId, itemId)
    pendingStreamingUpdatesRef.current.set(key, {
      threadId,
      itemId,
      role,
      text: streamingBuffersRef.current[key] ?? '',
      pending,
    })

    if (flushNow) {
      flushStreamingMessagesNow()
      return
    }
    if (streamingFrameRef.current === null) {
      streamingFrameRef.current = requestAnimationFrame(flushStreamingMessages)
    }
  }, [flushStreamingMessages, flushStreamingMessagesNow])

  useEffect(() => {
    const pendingStreamingUpdates = pendingStreamingUpdatesRef.current
    const unsubscribe = window.cranberri.codex.onEvent((event) => {
      const e = event as CodexEvent
      if (e.type === 'log') {
        if (window.location.protocol === 'http:') console.debug(`[codex ${e.level}]`, e.text)
        return
      }
      const threadId = (e as { threadId?: string }).threadId
      if (!threadId) return
      if (e.type === 'tool_event' && threadId === activeThreadIdRef.current) {
        recordToolActivityEvent(e.event)
      }

      if (e.type === 'agent_message_delta') {
        const role = agentMessageRole(e.phase)
        const key = streamingMessageKey(threadId, e.itemId)
        streamingBuffersRef.current[key] = (streamingBuffersRef.current[key] ?? '') + e.delta
        queueStreamingMessage(threadId, e.itemId, role, true)
        return
      }

      if (e.type === 'agent_message_completed') {
        const key = streamingMessageKey(threadId, e.itemId)
        if (e.text) streamingBuffersRef.current[key] = e.text
        queueStreamingMessage(threadId, e.itemId, agentMessageRole(e.phase), false, true)
        return
      }

      if (pendingStreamingUpdatesRef.current.size > 0) flushStreamingMessagesNow()

      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === threadId)
        if (idx === -1 && e.type === 'thread_name_updated') {
          pendingThreadTitlesRef.current[threadId] = e.title
        }
        if (idx === -1) return prev
        const next = [...prev]
        const thread = { ...next[idx] }

        switch (e.type) {
          case 'thread_name_updated':
            thread.title = e.title
            delete pendingThreadTitlesRef.current[threadId]
            break
          case 'tool_call':
            thread.currentActivity = `Calling ${e.tool.function}`
            break
          case 'tool_event':
            thread.currentActivity = e.event.status === 'approval_requested'
              ? 'Waiting for tool approval'
              : e.event.status === 'failed'
                ? `Tool failed: ${e.event.name}`
                : e.event.status === 'completed'
                  ? 'Working'
                  : `Calling ${e.event.name}`
            break
          case 'approval_request':
            thread.currentActivity = 'Waiting for approval'
            if (!thread.pendingApprovals.some((a) => a.reviewId === e.approval.reviewId)) {
              thread.pendingApprovals = [...thread.pendingApprovals, e.approval]
            }
            break
          case 'approval_completed': {
            thread.pendingApprovals = thread.pendingApprovals.filter((a) => a.reviewId !== e.reviewId)
            if (thread.pendingApprovals.length === 0) thread.currentActivity = 'Working'
            break
          }
          case 'run_start':
            thread.isRunning = true
            thread.runStartedAt = Date.now()
            thread.lastRunDurationMs = undefined
            thread.currentActivity = 'Working'
            break
          case 'item_started':
            thread.isRunning = true
            thread.currentActivity = e.itemType === 'reasoning' ? 'Thinking' : e.itemType === 'function_call' ? 'Calling tool' : 'Working'
            break
          case 'run_end': {
            thread.isRunning = false
            thread.currentActivity = undefined
            thread.lastRunDurationMs = thread.lastRunDurationMs ?? (thread.runStartedAt ? Date.now() - thread.runStartedAt : undefined)
            if (e.error) {
              thread.messages = [...thread.messages, {
                id: crypto.randomUUID(),
                role: 'system',
                content: `Error: ${e.error}`,
                timestamp: Date.now(),
              }]
            }
            break
          }
          case 'context_compaction': {
            thread.currentActivity = e.state === 'started' ? 'Compacting context' : thread.currentActivity
            const existingIdx = thread.messages.findIndex((m) => m.role === 'compact' && m.pending)
            if (e.state === 'started') {
              if (existingIdx === -1) {
                thread.messages = [...thread.messages, {
                  id: crypto.randomUUID(),
                  role: 'compact',
                  content: 'Compacting context',
                  timestamp: Date.now(),
                  pending: true,
                }]
              }
            } else {
              const content = e.state === 'completed' ? 'Context compacted' : `Compaction failed: ${e.message ?? e.state}`
              const hasCompletedCompaction = thread.messages.some((m) => m.role === 'compact' && !m.pending && m.content === content)
              if (existingIdx === -1 && !hasCompletedCompaction) {
                thread.messages = [...thread.messages, {
                  id: crypto.randomUUID(),
                  role: 'compact',
                  content,
                  timestamp: Date.now(),
                  pending: false,
                }]
              } else {
                thread.messages = thread.messages.map((m) =>
                  m.role === 'compact' && m.pending
                    ? { ...m, content, pending: false }
                    : m
                )
              }
            }
            break
          }
          case 'context_usage':
            thread.contextUsage = { usedTokens: e.usedTokens, contextWindow: e.contextWindow }
            break
          case 'final_answer': {
            // Legacy fallback: some old app-server versions still emit task_complete/final_answer.
            // Prefer the itemId-keyed agent_message_completed path above.
            const existing = [...thread.messages]
              .reverse()
              .find((message) => message.role === 'assistant' && (message.content === e.text || e.text.startsWith(message.content) || message.content.startsWith(e.text)))
            if (existing) {
              thread.messages = thread.messages.map((message) =>
                message.id === existing.id ? { ...message, content: e.text, pending: false } : message
              )
            } else {
              thread.messages = [...thread.messages, { id: crypto.randomUUID(), role: 'assistant', content: e.text, timestamp: Date.now() }]
            }
            thread.isRunning = false
            thread.currentActivity = undefined
            thread.lastRunDurationMs = thread.runStartedAt ? Date.now() - thread.runStartedAt : undefined
            break
          }
        }

        next[idx] = thread
        return next
      })
    })
    return () => {
      unsubscribe()
      if (streamingFrameRef.current !== null) cancelAnimationFrame(streamingFrameRef.current)
      streamingFrameRef.current = null
      pendingStreamingUpdates.clear()
    }
  }, [flushStreamingMessagesNow, queueStreamingMessage])

  const getThreadForWindow = useCallback((windowId: string) => windowToThread[windowId], [windowToThread])

  const closeThreadWindow = useCallback((windowId: string) => {
    const closedThreadId = windowToThread[windowId]
    if (closedThreadId) clearToolActivityEvents(closedThreadId)
    setWindowToThread((prev) => {
      if (!prev[windowId]) return prev
      const { [windowId]: closedThreadId, ...next } = prev
      setActiveThreadId((current) => current === closedThreadId ? (Object.values(next)[0] ?? null) : current)
      return next
    })
  }, [windowToThread])

  const markSendFailed = useCallback((threadId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to send message'
    setThreads((prev) => prev.map((thread) => thread.id === threadId
      ? applyCodexSendFailure(thread, message, crypto.randomUUID(), Date.now())
      : thread))
  }, [])

  const createThread = useCallback(async (windowId: string, initialContent?: string, settings?: CodexTurnSettings, initialInput?: CodexUserInput[]): Promise<CodexThread> => {
    if (!activeRepo) throw new Error('No active repo')
    const { threadId, title } = await window.cranberri.codex.createThread(activeRepo.path, settings)
    const pendingTitle = pendingThreadTitlesRef.current[threadId]
    delete pendingThreadTitlesRef.current[threadId]
    const thread: CodexThread = {
      id: threadId,
      title: pendingTitle ?? title ?? 'New thread',
      repoId: activeRepo.id,
      messages: initialContent
        ? [{
            id: crypto.randomUUID(),
            role: 'user',
            content: initialContent,
            timestamp: Date.now(),
          }]
        : [],
      pendingApprovals: [],
      isRunning: !!initialContent,
      currentActivity: initialContent ? 'Working' : undefined,
      runStartedAt: initialContent ? Date.now() : undefined,
    }
    setThreads((prev) => [...prev, thread])
    setActiveThreadId(threadId)
    setWindowToThread((prev) => ({ ...prev, [windowId]: threadId }))
    window.dispatchEvent(new CustomEvent('cranberri:codex-sessions-changed', { detail: { repoPath: activeRepo.path, threadId } }))
    if (initialContent) {
      try {
        await window.cranberri.codex.sendMessage(activeRepo.path, threadId, initialInput ?? [{ type: 'text', text: initialContent }], settings)
      } catch (error) {
        if (error && typeof error === 'object') {
          Object.assign(error, { threadCreated: true })
        }
        markSendFailed(threadId, error)
        throw error
      }
    }
    return thread
  }, [activeRepo, markSendFailed])

  const sendMessage = useCallback(async (threadId: string, content: string, input?: CodexUserInput[], settings?: CodexTurnSettings): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')

    logRendererTelemetry('chat:user:send', { threadId, contentLength: content.length, settings: settings ? { model: settings.model, effort: settings.effort, speed: settings.speed, approvalMode: settings.approvalMode } : null })

    let shouldResume = false
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      shouldResume = Boolean(next[idx].isHistorical)
      next[idx] = {
        ...next[idx],
        isHistorical: false,
        messages: [...next[idx].messages, {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          timestamp: Date.now(),
        }],
        isRunning: true,
        currentActivity: shouldResume ? 'Resuming' : 'Working',
        runStartedAt: Date.now(),
        lastRunDurationMs: undefined,
      }
      return next
    })

    try {
      if (shouldResume) await window.cranberri.codex.resumeThread(activeRepo.path, threadId, settings)
      await window.cranberri.codex.sendMessage(activeRepo.path, threadId, input ?? [{ type: 'text', text: content }], settings)
    } catch (error) {
      markSendFailed(threadId, error)
      throw error
    }
  }, [activeRepo, markSendFailed])

  const compactThread = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    logRendererTelemetry('chat:user:compact', { threadId })
    await window.cranberri.codex.compactThread(activeRepo.path, threadId)
  }, [activeRepo])

  const approve = useCallback(async (threadId: string, approvalId: string, action: 'approve' | 'deny' = 'approve'): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    const approval = threadsRef.current.find((t) => t.id === threadId)?.pendingApprovals.find((a) => a.id === approvalId)
    logRendererTelemetry('chat:user:approval', { threadId, approvalId, action, hasEvent: !!approval })
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        pendingApprovals: next[idx].pendingApprovals.filter((a) => a.id !== approvalId),
        isRunning: action === 'approve',
        currentActivity: action === 'approve' ? 'Working' : undefined,
        runStartedAt: next[idx].runStartedAt ?? Date.now(),
      }
      return next
    })
    if (action === 'approve') {
      await window.cranberri.codex.approve(activeRepo.path, threadId, approval?.review ?? approval?.action ?? {})
    } else {
      await window.cranberri.codex.interrupt(activeRepo.path, threadId)
    }
  }, [activeRepo])

  const abort = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    logRendererTelemetry('chat:user:abort', { threadId })
    await window.cranberri.codex.interrupt(activeRepo.path, threadId)
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], isRunning: false, currentActivity: undefined }
      return next
    })
  }, [activeRepo])

  const switchThread = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId)
  }, [])

  const openSession = useCallback(async (
    windowId: string,
    session: CodexSessionSummary,
    archived = false,
    repo: { id: string; path: string } | undefined = activeRepo ?? undefined,
  ): Promise<CodexThread> => {
    if (!repo) throw new Error('No active repo')
    const { thread } = await window.cranberri.codex.readThread(repo.path, session.id, archived)
    const hydrated = { ...hydrateThread(thread, repo.id), isHistorical: true }
    setThreads((prev) => [...prev.filter((item) => item.id !== hydrated.id), hydrated])
    setActiveThreadId(hydrated.id)
    setWindowToThread((prev) => ({ ...prev, [windowId]: hydrated.id }))
    return hydrated
  }, [activeRepo])

  const restoreSessionWindow = useCallback(async (windowId: string, threadId: string): Promise<CodexThread> => {
    if (!activeRepo) throw new Error('No active repo')
    const existing = threadsRef.current.find((thread) => thread.id === threadId && thread.repoId === activeRepo.id)
    if (existing) {
      setWindowToThread((prev) => ({ ...prev, [windowId]: existing.id }))
      return existing
    }

    let restored: CodexSessionThread
    try {
      restored = (await window.cranberri.codex.readThread(activeRepo.path, threadId, false)).thread
    } catch {
      restored = (await window.cranberri.codex.readThread(activeRepo.path, threadId, true)).thread
    }

    const hydrated = { ...hydrateThread(restored, activeRepo.id), isHistorical: true }
    setThreads((prev) => [...prev.filter((thread) => thread.id !== hydrated.id), hydrated])
    setWindowToThread((prev) => ({ ...prev, [windowId]: hydrated.id }))
    return hydrated
  }, [activeRepo])

  const archiveSession = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.archiveThread(activeRepo.path, threadId)
    clearToolActivityEvents(threadId)
    window.dispatchEvent(new CustomEvent('cranberri:codex-sessions-changed', { detail: { repoPath: activeRepo.path, threadId } }))
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
    setWindowToThread((prev) => Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== threadId)))
  }, [activeRepo])

  const unarchiveSession = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.unarchiveThread(activeRepo.path, threadId)
    window.dispatchEvent(new CustomEvent('cranberri:codex-sessions-changed', { detail: { repoPath: activeRepo.path, threadId } }))
  }, [activeRepo])

  const deleteSession = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.deleteThread(activeRepo.path, threadId)
    clearToolActivityEvents(threadId)
    window.dispatchEvent(new CustomEvent('cranberri:codex-sessions-changed', { detail: { repoPath: activeRepo.path, threadId } }))
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
    setWindowToThread((prev) => Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== threadId)))
  }, [activeRepo])

  const renameSession = useCallback(async (threadId: string, name: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.renameThread(activeRepo.path, threadId, name)
    window.dispatchEvent(new CustomEvent('cranberri:codex-sessions-changed', { detail: { repoPath: activeRepo.path, threadId } }))
    setThreads((prev) => prev.map((thread) => thread.id === threadId ? { ...thread, title: name } : thread))
  }, [activeRepo])

  const threadState = useMemo<CodexThreadStateApi>(() => ({
    threads,
    activeThread,
    getThread,
  }), [activeThread, getThread, threads])
  const windowState = useMemo<CodexWindowStateApi>(() => ({
    activeThreadId,
    openThreadIds,
    getThreadForWindow,
  }), [activeThreadId, getThreadForWindow, openThreadIds])
  const actions = useMemo<CodexActionsApi>(() => ({
    getThreadSnapshot,
    createThread,
    sendMessage,
    compactThread,
    approve,
    abort,
    switchThread,
    closeThreadWindow,
    openSession,
    restoreSessionWindow,
    archiveSession,
    unarchiveSession,
    deleteSession,
    renameSession,
  }), [
    abort,
    approve,
    archiveSession,
    closeThreadWindow,
    compactThread,
    createThread,
    deleteSession,
    getThreadSnapshot,
    openSession,
    renameSession,
    restoreSessionWindow,
    sendMessage,
    switchThread,
    unarchiveSession,
  ])

  return (
    <CodexActionsContext.Provider value={actions}>
      <CodexWindowStateContext.Provider value={windowState}>
        <CodexThreadStateContext.Provider value={threadState}>
          {children}
        </CodexThreadStateContext.Provider>
      </CodexWindowStateContext.Provider>
    </CodexActionsContext.Provider>
  )
}

export function useCodexThreads(): CodexThreadStateApi {
  const context = useContext(CodexThreadStateContext)
  if (!context) throw new Error('useCodexThreads must be used inside CodexProvider')
  return context
}

export function useCodexWindows(): CodexWindowStateApi {
  const context = useContext(CodexWindowStateContext)
  if (!context) throw new Error('useCodexWindows must be used inside CodexProvider')
  return context
}

export function useCodexActions(): CodexActionsApi {
  const context = useContext(CodexActionsContext)
  if (!context) throw new Error('useCodexActions must be used inside CodexProvider')
  return context
}

export function useCodex(): CodexApi {
  const threadState = useCodexThreads()
  const windowState = useCodexWindows()
  const actions = useCodexActions()
  return useMemo(() => ({ ...threadState, ...windowState, ...actions }), [actions, threadState, windowState])
}
