import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { CodexMessage, CodexEvent, CodexSessionSummary, CodexSessionThread, CodexThread, CodexTurnSettings, CodexUserInput } from '@/shared/codex'
import { useRepos } from './repos'

interface CodexApi {
  threads: CodexThread[]
  activeThreadId: string | null
  activeThread: CodexThread | null
  openThreadIds: string[]
  getThread: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string, settings?: CodexTurnSettings, initialInput?: CodexUserInput[]) => Promise<CodexThread>
  sendMessage: (threadId: string, content: string, input?: CodexUserInput[], settings?: CodexTurnSettings) => Promise<void>
  compactThread: (threadId: string) => Promise<void>
  approve: (threadId: string, approvalId: string, action?: 'approve' | 'deny') => Promise<void>
  abort: (threadId: string) => Promise<void>
  switchThread: (threadId: string) => void
  getThreadForWindow: (windowId: string) => string | undefined
  closeThreadWindow: (windowId: string) => void
  openSession: (windowId: string, session: CodexSessionSummary, archived?: boolean) => Promise<CodexThread>
  archiveSession: (threadId: string) => Promise<void>
  unarchiveSession: (threadId: string) => Promise<void>
  deleteSession: (threadId: string) => Promise<void>
  renameSession: (threadId: string, name: string) => Promise<void>
}

const CodexContext = createContext<CodexApi | null>(null)

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
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [windowToThread, setWindowToThread] = useState<Record<string, string>>({})
  const streamingBuffersRef = useRef<Record<string, string>>({})
  const pendingThreadTitlesRef = useRef<Record<string, string>>({})

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null
  const openThreadIds = [...new Set(Object.values(windowToThread))]
  const getThread = useCallback((threadId: string) => threads.find((t) => t.id === threadId), [threads])

  const updateStreamingMessage = useCallback((threadId: string, itemId: string, delta: string, role: 'assistant' | 'reasoning') => {
    streamingBuffersRef.current[itemId] = (streamingBuffersRef.current[itemId] ?? '') + delta
    const text = streamingBuffersRef.current[itemId]
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      const thread = { ...next[idx] }
      const existing = thread.messages.find((message) => message.id === itemId)
      thread.messages = existing
        ? thread.messages.map((message) => message.id === itemId ? { ...message, role, content: text } : message)
        : [...thread.messages, { id: itemId, role, content: text, timestamp: Date.now(), pending: true }]
      next[idx] = thread
      return next
    })
  }, [])

  const finalizeStreamingMessage = useCallback((threadId: string, itemId: string, role?: 'assistant' | 'reasoning') => {
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      const thread = { ...next[idx] }
      const finalText = streamingBuffersRef.current[itemId] ?? ''
      thread.messages = thread.messages.map((m) => {
        if (m.id !== itemId) return m
        return { ...m, content: finalText || m.content, pending: false, ...(role ? { role } : {}) }
      })
      next[idx] = thread
      return next
    })
  }, [])
  useEffect(() => {
    return window.cranberri.codex.onEvent((event) => {
      const e = event as CodexEvent
      if (e.type === 'log') {
        if (window.location.protocol === 'http:') console.debug(`[codex ${e.level}]`, e.text)
        return
      }
      const threadId = (e as { threadId?: string }).threadId
      if (!threadId) return

      if (e.type === 'agent_message_delta') {
        const role = agentMessageRole(e.phase)
        queueMicrotask(() => updateStreamingMessage(threadId, e.itemId, e.delta, role))
        return
      }

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
          case 'agent_message_completed':
            if (e.text) {
              thread.currentActivity = 'Writing'
              streamingBuffersRef.current[e.itemId] = e.text
            }
            queueMicrotask(() => finalizeStreamingMessage(threadId, e.itemId, agentMessageRole(e.phase)))
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
  }, [updateStreamingMessage, finalizeStreamingMessage])

  const getThreadForWindow = useCallback((windowId: string) => windowToThread[windowId], [windowToThread])

  const closeThreadWindow = useCallback((windowId: string) => {
    setWindowToThread((prev) => {
      if (!prev[windowId]) return prev
      const { [windowId]: closedThreadId, ...next } = prev
      setActiveThreadId((current) => current === closedThreadId ? (Object.values(next)[0] ?? null) : current)
      return next
    })
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
        const message = error instanceof Error ? error.message : 'Failed to send message'
        if (error && typeof error === 'object') {
          Object.assign(error, { threadCreated: true })
        }
        setThreads((prev) => prev.map((item) => item.id === threadId
          ? {
              ...item,
              isRunning: false,
              currentActivity: undefined,
              messages: [...item.messages, {
                id: crypto.randomUUID(),
                role: 'system',
                content: `Error: ${message}`,
                timestamp: Date.now(),
              }],
            }
          : item))
        throw error
      }
    }
    return thread
  }, [activeRepo])

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

    if (shouldResume) await window.cranberri.codex.resumeThread(activeRepo.path, threadId, settings)
    await window.cranberri.codex.sendMessage(activeRepo.path, threadId, input ?? [{ type: 'text', text: content }], settings)
  }, [activeRepo])

  const compactThread = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    logRendererTelemetry('chat:user:compact', { threadId })
    await window.cranberri.codex.compactThread(activeRepo.path, threadId)
  }, [activeRepo])

  const approve = useCallback(async (threadId: string, approvalId: string, action: 'approve' | 'deny' = 'approve'): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    const approval = threads.find((t) => t.id === threadId)?.pendingApprovals.find((a) => a.id === approvalId)
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
  }, [activeRepo, threads])

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

  const switchThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId)
  }, [])

  const openSession = useCallback(async (windowId: string, session: CodexSessionSummary, archived = false): Promise<CodexThread> => {
    if (!activeRepo) throw new Error('No active repo')
    const { thread } = await window.cranberri.codex.readThread(activeRepo.path, session.id, archived)
    const hydrated = { ...hydrateThread(thread, activeRepo.id), isHistorical: true }
    setThreads((prev) => [...prev.filter((item) => item.id !== hydrated.id), hydrated])
    setActiveThreadId(hydrated.id)
    setWindowToThread((prev) => ({ ...prev, [windowId]: hydrated.id }))
    return hydrated
  }, [activeRepo])

  const archiveSession = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.archiveThread(activeRepo.path, threadId)
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

  return (
    <CodexContext.Provider
      value={{ threads, activeThreadId, activeThread, openThreadIds, getThread, createThread, sendMessage, compactThread, approve, abort, switchThread, getThreadForWindow, closeThreadWindow, openSession, archiveSession, unarchiveSession, deleteSession, renameSession }}
    >
      {children}
    </CodexContext.Provider>
  )
}

export function useCodex(): CodexApi {
  const ctx = useContext(CodexContext)
  if (!ctx) throw new Error('useCodex must be used inside CodexProvider')
  return ctx
}
