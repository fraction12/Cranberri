import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { CodexEvent, CodexSessionSummary, CodexSessionThread, CodexThread, CodexTurnSettings, CodexUserInput, CodexWorker } from '@/shared/codex'
import {
  codexWorkerIsActive,
  mergeCodexWorker,
  mergeWorkerCollections,
  workersFromSessionThread,
} from '@/shared/codex-workers'
import { useRepos } from './repos'
import { useOptionalTasks } from './tasks'
import { applyCodexSendFailure } from './codex-send-failure'
import { applyStreamingMessageUpdates, streamingMessageKey, type StreamingMessageUpdate } from './codex-streaming'
import {
  appendCodexSteeringItem,
  appendCodexTurnError,
  applyCodexItemLifecycle,
  completeCodexActivityTurn,
  createOptimisticCodexTurn,
  hydrateCodexTranscript,
  reconcileCodexTurnStarted,
} from './codex-turn-activity'
import { clearToolActivityEvents, recordToolActivityEvent } from './tools'
import { applyWorkerUpdate, hydrateSessionWorkerGraph, hydrateWorkersFromGraph, upsertWorkerGraph } from './codex-workers'
import type { Task } from '@/shared/tasks'
import { BIND_WORKSPACE_WINDOW_THREAD_EVENT } from './workspace-model'
import { invalidateSessions } from './session-invalidation'

interface CodexThreadStateApi {
  threads: CodexThread[]
  activeThread: CodexThread | null
  getThread: (threadId: string) => CodexThread | undefined
  workersByParent: Readonly<Record<string, CodexWorker[]>>
  getWorkersForThread: (threadId: string) => CodexWorker[]
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
  steerThread: (threadId: string, content: string, input?: CodexUserInput[]) => Promise<void>
  compactThread: (threadId: string) => Promise<void>
  approve: (threadId: string, approvalId: string, action?: 'approve' | 'deny') => Promise<void>
  abort: (threadId: string) => Promise<void>
  messageWorker: (parentThreadId: string, workerThreadId: string, content: string, input?: CodexUserInput[]) => Promise<void>
  stopWorker: (parentThreadId: string, workerThreadId: string) => Promise<void>
  switchThread: (threadId: string | null) => void
  closeThreadWindow: (windowId: string) => void
  openSession: (
    windowId: string,
    session: CodexSessionSummary,
    archived?: boolean,
    repo?: { id: string; path: string },
  ) => Promise<CodexThread>
  restoreSessionWindow: (windowId: string, threadId: string) => Promise<CodexThread>
  bindTaskWindow: (windowId: string, task: Task, initialContent?: string) => Promise<CodexThread>
  markThreadSendFailed: (threadId: string, error: unknown) => void
  archiveSession: (threadId: string, repoPath?: string) => Promise<void>
  unarchiveSession: (threadId: string, repoPath?: string) => Promise<void>
  deleteSession: (threadId: string, repoPath?: string) => Promise<void>
  renameSession: (threadId: string, name: string, repoPath?: string) => Promise<void>
}

type CodexApi = CodexThreadStateApi & CodexWindowStateApi & CodexActionsApi

const CodexThreadStateContext = createContext<CodexThreadStateApi | null>(null)
const CodexWindowStateContext = createContext<CodexWindowStateApi | null>(null)
const CodexActionsContext = createContext<CodexActionsApi | null>(null)

function agentMessageRole(phase: string | null | undefined): 'assistant' | 'reasoning' {
  // Only explicit commentary / reasoning phases belong in the collapsible reasoning group.
  // Everything else — including missing, unknown, or final_answer phases — renders as a
  // first-class assistant message so the final response is never hidden.
  if (phase === 'commentary' || phase === 'reasoning') return 'reasoning'
  return 'assistant'
}

function hydrateThread(session: CodexSessionThread, repoId: string): CodexThread {
  const transcript = hydrateCodexTranscript(session)
  const lastTurn = [...session.turns].reverse().find((turn) => turn.durationMs)
  const statusType = session.status && typeof session.status === 'object'
    ? (session.status as { type?: unknown }).type
    : session.status
  const isRunning = statusType === 'active'
    || statusType === 'running'
    || statusType === 'inProgress'
    || transcript.activityTurns.some((turn) => turn.status === 'running')
  return {
    id: session.id,
    title: session.title,
    repoId,
    messages: transcript.messages,
    activityTurns: transcript.activityTurns,
    pendingApprovals: [],
    isRunning,
    currentActivity: isRunning ? 'Working' : undefined,
    lastRunDurationMs: lastTurn?.durationMs ?? undefined,
    contextUsage: undefined,
    sessionId: session.sessionId,
    parentThreadId: session.parentThreadId,
    agentNickname: session.agentNickname,
    agentRole: session.agentRole,
    workers: mergeWorkerCollections(session.workers, workersFromSessionThread(session)),
    isHistorical: !isRunning,
  }
}

function logRendererTelemetry(type: string, payload: unknown): void {
  window.cranberri.telemetry.log('renderer', type, payload).catch((err) => {
    console.warn('Failed to write telemetry:', err)
  })
}

function publishWindowThreadBinding(windowId: string, threadId: string, projectId: string): void {
  window.dispatchEvent(new CustomEvent(BIND_WORKSPACE_WINDOW_THREAD_EVENT, {
    detail: { windowId, threadId, projectId },
  }))
}

export function CodexProvider({ children }: { children: React.ReactNode }) {
  const { activeRepo, repos } = useRepos()
  const tasks = useOptionalTasks()
  const [threads, setThreads] = useState<CodexThread[]>([])
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const reposRef = useRef(repos)
  reposRef.current = repos
  const [workersByParent, setWorkersByParent] = useState<Record<string, CodexWorker[]>>({})
  const workersByParentRef = useRef(workersByParent)
  workersByParentRef.current = workersByParent
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
  const getWorkersForThread = useCallback((threadId: string) => workersByParent[threadId] ?? [], [workersByParent])
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
    turnId: string | undefined,
    itemId: string,
    role: 'assistant' | 'reasoning',
    pending: boolean,
    flushNow = false,
  ) => {
    const key = streamingMessageKey(threadId, itemId)
    pendingStreamingUpdatesRef.current.set(key, {
      threadId,
      turnId,
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
        queueStreamingMessage(threadId, e.turnId, e.itemId, role, true)
        return
      }

      if (e.type === 'agent_message_completed') {
        const key = streamingMessageKey(threadId, e.itemId)
        if (e.text) streamingBuffersRef.current[key] = e.text
        queueStreamingMessage(threadId, e.turnId, e.itemId, agentMessageRole(e.phase), false, true)
        return
      }

      if (e.type === 'worker_updated') {
        if (pendingStreamingUpdatesRef.current.size > 0) flushStreamingMessagesNow()
        const parent = threadsRef.current.find((thread) => thread.id === e.threadId)
        const knownWorkers = parent?.workers ?? workersByParentRef.current[e.threadId] ?? []
        const isNewWorker = !knownWorkers.some((worker) => worker.threadId === e.worker.threadId)
        setWorkersByParent((current) => upsertWorkerGraph(current, e.threadId, e.worker))
        setThreads((current) => applyWorkerUpdate(current, e.threadId, e.worker))
        if (isNewWorker) {
          const repoPath = e.worker.cwd
            ?? (parent ? reposRef.current.find((repo) => repo.id === parent.repoId)?.path : undefined)
          if (repoPath) {
            invalidateSessions({ repoPath, threadId: e.threadId })
          }
        }
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
        let thread = { ...next[idx] }

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
            if (e.turnId) {
              thread = reconcileCodexTurnStarted(thread, e.turnId, e.startedAt ?? Date.now())
            }
            thread.isRunning = true
            thread.runStartedAt = e.startedAt ?? thread.runStartedAt ?? Date.now()
            thread.lastRunDurationMs = undefined
            thread.currentActivity = 'Working'
            break
          case 'item_started': {
            if (e.turnId && e.item) {
              thread = applyCodexItemLifecycle(thread, e.turnId, e.item, 'started', e.startedAt ?? Date.now())
            }
            thread.isRunning = true
            const activeItem = thread.activityTurns?.find((turn) => turn.id === e.turnId)?.items.at(-1)
            thread.currentActivity = activeItem?.title ?? (e.itemType === 'reasoning' ? 'Thinking' : e.itemType === 'function_call' ? 'Calling tool' : 'Working')
            break
          }
          case 'item_completed': {
            if (e.turnId && e.item) {
              thread = applyCodexItemLifecycle(thread, e.turnId, e.item, 'completed', e.completedAt ?? Date.now())
            }
            const runningItem = thread.activityTurns
              ?.find((turn) => turn.id === e.turnId)
              ?.items.findLast((item) => item.status === 'running')
            thread.currentActivity = runningItem?.title ?? 'Working'
            break
          }
          case 'run_end': {
            thread = completeCodexActivityTurn(
              thread,
              e.turnId,
              e.status ?? (e.error ? 'failed' : 'completed'),
              e.completedAt ?? Date.now(),
              e.durationMs,
            )
            thread.isRunning = false
            thread.currentActivity = undefined
            thread.lastRunDurationMs = e.durationMs ?? thread.lastRunDurationMs ?? (thread.runStartedAt ? Date.now() - thread.runStartedAt : undefined)
            if (e.error && e.status !== 'interrupted') {
              const hasActivityTurn = (thread.activityTurns?.length ?? 0) > 0
              if (hasActivityTurn) {
                thread = appendCodexTurnError(thread, e.turnId, e.error, e.completedAt ?? Date.now())
              } else {
                thread.messages = [...thread.messages, {
                  id: crypto.randomUUID(),
                  role: 'system',
                  content: `Error: ${e.error}`,
                  timestamp: Date.now(),
                }]
              }
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
                  turnId: e.turnId,
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
                  turnId: e.turnId,
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
            thread = completeCodexActivityTurn(thread, undefined, 'completed', Date.now(), thread.lastRunDurationMs)
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
      const { [windowId]: removedThreadId, ...next } = prev
      void removedThreadId
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
    const initialMessageId = initialContent ? crypto.randomUUID() : undefined
    const initialStartedAt = Date.now()
    const initialTurn = initialMessageId ? createOptimisticCodexTurn(initialMessageId, initialStartedAt) : undefined
    const thread: CodexThread = {
      id: threadId,
      title: pendingTitle ?? title ?? 'New thread',
      repoId: activeRepo.id,
      messages: initialContent
        ? [{
            id: initialMessageId!,
            role: 'user',
            content: initialContent,
            timestamp: initialStartedAt,
            turnId: initialTurn?.id,
          }]
        : [],
      activityTurns: initialTurn ? [initialTurn] : [],
      pendingApprovals: [],
      isRunning: !!initialContent,
      currentActivity: initialContent ? 'Working' : undefined,
      runStartedAt: initialContent ? initialStartedAt : undefined,
      workers: [],
    }
    setThreads((prev) => [...prev, thread])
    setWindowToThread((prev) => ({ ...prev, [windowId]: threadId }))
    publishWindowThreadBinding(windowId, threadId, activeRepo.id)
    invalidateSessions({ projectId: activeRepo.id, repoPath: activeRepo.path, threadId })
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
    const messageId = crypto.randomUUID()
    const startedAt = Date.now()
    const optimisticTurn = createOptimisticCodexTurn(messageId, startedAt)
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      shouldResume = Boolean(next[idx].isHistorical)
      next[idx] = {
        ...next[idx],
        isHistorical: false,
        messages: [...next[idx].messages, {
          id: messageId,
          role: 'user',
          content,
          timestamp: startedAt,
          turnId: optimisticTurn.id,
        }],
        activityTurns: [...(next[idx].activityTurns ?? []), optimisticTurn],
        isRunning: true,
        currentActivity: shouldResume ? 'Resuming' : 'Working',
        runStartedAt: startedAt,
        lastRunDurationMs: undefined,
      }
      return next
    })

    try {
      const taskApi = tasks
      const boundTask = taskApi?.tasks.find((task) => task.threadId === threadId)
      if (boundTask && taskApi) {
        if (shouldResume) await window.cranberri.tasks.resume(boundTask.id)
        await window.cranberri.tasks.send({
          taskId: boundTask.id,
          input: input ?? [{ type: 'text', text: content }],
          settings,
        })
        await taskApi.refresh()
      } else {
        if (shouldResume) await window.cranberri.codex.resumeThread(activeRepo.path, threadId, settings)
        await window.cranberri.codex.sendMessage(activeRepo.path, threadId, input ?? [{ type: 'text', text: content }], settings)
      }
    } catch (error) {
      markSendFailed(threadId, error)
      throw error
    }
  }, [activeRepo, markSendFailed, tasks])

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
      const stopped = completeCodexActivityTurn(next[idx], undefined, 'interrupted', Date.now())
      next[idx] = { ...stopped, isRunning: false, currentActivity: undefined }
      return next
    })
  }, [activeRepo])

  const repoPathForThread = useCallback((threadId: string): string => {
    const thread = threadsRef.current.find((candidate) => candidate.id === threadId)
    const repo = repos.find((candidate) => candidate.id === thread?.repoId) ?? activeRepo
    if (!repo) throw new Error('The worker repository is no longer available.')
    return repo.path
  }, [activeRepo, repos])

  const steerThread = useCallback(async (
    threadId: string,
    content: string,
    input?: CodexUserInput[],
  ): Promise<void> => {
    const itemId = `steer:${crypto.randomUUID()}`
    const timestamp = Date.now()
    logRendererTelemetry('chat:user:steer', { threadId, contentLength: content.length })
    setThreads((current) => current.map((thread) => thread.id === threadId
      ? appendCodexSteeringItem(thread, content, timestamp, itemId)
      : thread))

    try {
      await window.cranberri.codex.steerThread(
        repoPathForThread(threadId),
        threadId,
        input ?? [{ type: 'text', text: content }],
      )
    } catch (error) {
      setThreads((current) => current.map((thread) => thread.id === threadId
        ? {
            ...thread,
            activityTurns: thread.activityTurns?.map((turn) => ({
              ...turn,
              items: turn.items.map((item) => item.id === itemId
                ? { ...item, status: 'failed' as const, title: 'Direction not sent' }
                : item),
            })),
          }
        : thread))
      throw error
    }
  }, [repoPathForThread])

  const updateWorker = useCallback((parentThreadId: string, worker: CodexWorker): void => {
    setWorkersByParent((current) => upsertWorkerGraph(current, parentThreadId, worker))
    setThreads((current) => applyWorkerUpdate(current, parentThreadId, worker))
  }, [])

  const messageWorker = useCallback(async (
    parentThreadId: string,
    workerThreadId: string,
    content: string,
    input?: CodexUserInput[],
  ): Promise<void> => {
    const instruction = content.trim()
    if (!instruction) return
    const parent = threadsRef.current.find((thread) => thread.id === parentThreadId)
    const existing = parent?.workers?.find((worker) => worker.threadId === workerThreadId)
      ?? workersByParentRef.current[parentThreadId]?.find((worker) => worker.threadId === workerThreadId)
    if (!existing) throw new Error('This worker is no longer attached to the parent task.')
    const repoPath = repoPathForThread(parentThreadId)
    const wasActive = codexWorkerIsActive(existing.status)
    const controlInput = input?.some((part) => part.type === 'text')
      ? input
      : [{ type: 'text' as const, text: instruction }, ...(input ?? [])]
    await window.cranberri.codex.controlWorker(
      repoPath,
      parentThreadId,
      workerThreadId,
      wasActive ? 'message' : 'resume',
      controlInput,
    )
    const updated = mergeCodexWorker(existing, {
      ...existing,
      status: existing.status,
      lastInstruction: instruction,
      message: wasActive ? 'Direction sent through parent' : 'Resume requested through parent',
      updatedAt: Date.now(),
    })
    updateWorker(parentThreadId, updated)
    setThreads((current) => current.map((thread) => thread.id === workerThreadId
      ? {
          ...thread,
          isHistorical: wasActive ? false : thread.isHistorical,
          isRunning: codexWorkerIsActive(updated.status),
          currentActivity: codexWorkerIsActive(updated.status) ? updated.message : undefined,
          messages: [...thread.messages, {
            id: crypto.randomUUID(),
            role: 'user',
            content: instruction,
            timestamp: Date.now(),
          }],
        }
      : thread))
  }, [repoPathForThread, updateWorker])

  const stopWorker = useCallback(async (parentThreadId: string, workerThreadId: string): Promise<void> => {
    const parent = threadsRef.current.find((thread) => thread.id === parentThreadId)
    const existing = parent?.workers?.find((worker) => worker.threadId === workerThreadId)
      ?? workersByParentRef.current[parentThreadId]?.find((worker) => worker.threadId === workerThreadId)
    if (!existing) throw new Error('This worker is no longer attached to the parent task.')
    await window.cranberri.codex.controlWorker(
      repoPathForThread(parentThreadId),
      parentThreadId,
      workerThreadId,
      'stop',
      [],
    )
  }, [repoPathForThread])

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
    let thread: CodexSessionThread
    try {
      thread = (await window.cranberri.codex.readThread(repo.path, session.id, archived)).thread
    } catch {
      thread = (await window.cranberri.codex.readThread(repo.path, session.id, !archived)).thread
    }
    const hydratedBase = hydrateThread(thread, repo.id)
    const mergedWorkers = mergeWorkerCollections(hydratedBase.workers, workersByParentRef.current[hydratedBase.id])
    const hydrated = {
      ...hydratedBase,
      workers: hydrateWorkersFromGraph(workersByParentRef.current, mergedWorkers),
    }
    setWorkersByParent((current) => hydrateSessionWorkerGraph(current, thread, hydrated.workers ?? []))
    setThreads((prev) => [...prev.filter((item) => item.id !== hydrated.id), hydrated])
    setWindowToThread((prev) => ({ ...prev, [windowId]: hydrated.id }))
    publishWindowThreadBinding(windowId, hydrated.id, repo.id)
    return hydrated
  }, [activeRepo])

  const restoreSessionWindow = useCallback(async (windowId: string, threadId: string): Promise<CodexThread> => {
    if (!activeRepo) throw new Error('No active repo')
    const existing = threadsRef.current.find((thread) => thread.id === threadId && thread.repoId === activeRepo.id)
    if (existing) {
      setWindowToThread((prev) => ({ ...prev, [windowId]: existing.id }))
      publishWindowThreadBinding(windowId, existing.id, activeRepo.id)
      return existing
    }

    let restored: CodexSessionThread
    try {
      restored = (await window.cranberri.codex.readThread(activeRepo.path, threadId, false)).thread
    } catch {
      restored = (await window.cranberri.codex.readThread(activeRepo.path, threadId, true)).thread
    }

    const hydratedBase = hydrateThread(restored, activeRepo.id)
    const mergedWorkers = mergeWorkerCollections(hydratedBase.workers, workersByParentRef.current[hydratedBase.id])
    const hydrated = {
      ...hydratedBase,
      workers: hydrateWorkersFromGraph(workersByParentRef.current, mergedWorkers),
    }
    setWorkersByParent((current) => hydrateSessionWorkerGraph(current, restored, hydrated.workers ?? []))
    setThreads((prev) => [...prev.filter((thread) => thread.id !== hydrated.id), hydrated])
    setWindowToThread((prev) => ({ ...prev, [windowId]: hydrated.id }))
    publishWindowThreadBinding(windowId, hydrated.id, activeRepo.id)
    return hydrated
  }, [activeRepo])

  const bindTaskWindow = useCallback(async (windowId: string, task: Task, initialContent?: string): Promise<CodexThread> => {
    if (!task.threadId) throw new Error('Task has no Codex thread')
    const pendingTitle = pendingThreadTitlesRef.current[task.threadId]
    delete pendingThreadTitlesRef.current[task.threadId]

    let hydrated: CodexThread
    if (initialContent) {
      const messageId = crypto.randomUUID()
      const startedAt = Date.now()
      const optimisticTurn = createOptimisticCodexTurn(messageId, startedAt)
      const initialTitle = initialContent.split('\n')[0]?.trim().slice(0, 160) || 'New session'
      const meaningfulPendingTitle = pendingTitle && pendingTitle !== 'Untitled session' ? pendingTitle : null
      hydrated = {
        id: task.threadId,
        title: meaningfulPendingTitle ?? initialTitle,
        repoId: task.projectId,
        messages: [{ id: messageId, role: 'user', content: initialContent, timestamp: startedAt, turnId: optimisticTurn.id }],
        activityTurns: [optimisticTurn],
        pendingApprovals: [],
        isRunning: true,
        currentActivity: 'Working',
        runStartedAt: startedAt,
        workers: [],
      }
    } else {
      const result = await window.cranberri.tasks.read(task.id)
      const base = hydrateThread(result.thread, result.task.projectId)
      hydrated = { ...base, title: pendingTitle ?? base.title }
      setWorkersByParent((current) => hydrateSessionWorkerGraph(current, result.thread, hydrated.workers ?? []))
    }

    const nextThreads = [...threadsRef.current.filter((candidate) => candidate.id !== hydrated.id), hydrated]
    threadsRef.current = nextThreads
    setThreads(nextThreads)
    setWindowToThread((current) => ({ ...current, [windowId]: hydrated.id }))
    publishWindowThreadBinding(windowId, hydrated.id, task.projectId)
    return hydrated
  }, [])

  const markThreadSendFailed = useCallback((threadId: string, error: unknown) => {
    markSendFailed(threadId, error)
  }, [markSendFailed])

  const archiveSession = useCallback(async (threadId: string, repoPath?: string): Promise<void> => {
    const targetRepoPath = repoPath ?? activeRepo?.path
    if (!targetRepoPath) throw new Error('No repo selected')
    const snapshot = await window.cranberri.tasks.snapshot()
    const task = snapshot.tasks.find((candidate) => candidate.threadId === threadId)
    if (task) await window.cranberri.tasks.archive(task.id)
    else await window.cranberri.codex.archiveThread(targetRepoPath, threadId)
    clearToolActivityEvents(threadId)
    invalidateSessions({ repoPath: targetRepoPath, threadId })
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
    setWindowToThread((prev) => Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== threadId)))
  }, [activeRepo])

  const unarchiveSession = useCallback(async (threadId: string, repoPath?: string): Promise<void> => {
    const targetRepoPath = repoPath ?? activeRepo?.path
    if (!targetRepoPath) throw new Error('No repo selected')
    const snapshot = await window.cranberri.tasks.snapshot()
    const task = snapshot.tasks.find((candidate) => candidate.threadId === threadId)
    if (task) await window.cranberri.tasks.unarchive(task.id)
    else await window.cranberri.codex.unarchiveThread(targetRepoPath, threadId)
    invalidateSessions({ repoPath: targetRepoPath, threadId })
  }, [activeRepo])

  const deleteSession = useCallback(async (threadId: string, repoPath?: string): Promise<void> => {
    const targetRepoPath = repoPath ?? activeRepo?.path
    if (!targetRepoPath) throw new Error('No repo selected')
    const snapshot = await window.cranberri.tasks.snapshot()
    const task = snapshot.tasks.find((candidate) => candidate.threadId === threadId)
    if (task) await window.cranberri.tasks.delete(task.id)
    else await window.cranberri.codex.deleteThread(targetRepoPath, threadId)
    clearToolActivityEvents(threadId)
    invalidateSessions({ repoPath: targetRepoPath, threadId })
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId))
    setWorkersByParent((current) => {
      const { [threadId]: removed, ...rest } = current
      void removed
      return rest
    })
    setWindowToThread((prev) => Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== threadId)))
  }, [activeRepo])

  const renameSession = useCallback(async (threadId: string, name: string, repoPath?: string): Promise<void> => {
    const targetRepoPath = repoPath ?? activeRepo?.path
    if (!targetRepoPath) throw new Error('No repo selected')
    await window.cranberri.codex.renameThread(targetRepoPath, threadId, name)
    invalidateSessions({ repoPath: targetRepoPath, threadId })
    setThreads((prev) => prev.map((thread) => thread.id === threadId ? { ...thread, title: name } : thread))
  }, [activeRepo])

  const threadState = useMemo<CodexThreadStateApi>(() => ({
    threads,
    activeThread,
    getThread,
    workersByParent,
    getWorkersForThread,
  }), [activeThread, getThread, getWorkersForThread, threads, workersByParent])
  const windowState = useMemo<CodexWindowStateApi>(() => ({
    activeThreadId,
    openThreadIds,
    getThreadForWindow,
  }), [activeThreadId, getThreadForWindow, openThreadIds])
  const actions = useMemo<CodexActionsApi>(() => ({
    getThreadSnapshot,
    createThread,
    sendMessage,
    steerThread,
    compactThread,
    approve,
    abort,
    messageWorker,
    stopWorker,
    switchThread,
    closeThreadWindow,
    openSession,
    restoreSessionWindow,
    bindTaskWindow,
    markThreadSendFailed,
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
    messageWorker,
    openSession,
    renameSession,
    restoreSessionWindow,
    bindTaskWindow,
    markThreadSendFailed,
    sendMessage,
    steerThread,
    stopWorker,
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
