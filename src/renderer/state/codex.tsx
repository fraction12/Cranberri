import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { CodexMessage, CodexEvent, CodexSessionSummary, CodexSessionThread, CodexThread, CodexTurnSettings } from '@/shared/codex'
import { useRepos } from './repos'

interface CodexApi {
  threads: CodexThread[]
  activeThreadId: string | null
  activeThread: CodexThread | null
  openThreadIds: string[]
  getThread: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string) => Promise<CodexThread>
  sendMessage: (threadId: string, content: string, settings?: CodexTurnSettings) => Promise<void>
  compactThread: (threadId: string) => Promise<void>
  approve: (threadId: string, approvalId: string) => Promise<void>
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
          role: item.phase === 'final_answer' ? 'assistant' : 'reasoning',
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

function summarizeThread(thread: CodexThread): Record<string, unknown> {
  return {
    id: thread.id,
    title: thread.title,
    isRunning: thread.isRunning,
    currentActivity: thread.currentActivity,
    runStartedAt: thread.runStartedAt,
    lastRunDurationMs: thread.lastRunDurationMs,
    messageCount: thread.messages.length,
    messages: thread.messages.slice(-12).map((message) => ({
      id: message.id,
      role: message.role,
      length: message.content.length,
      preview: message.content.slice(0, 80),
      pending: message.pending,
    })),
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
  const streamTimersRef = useRef<Record<string, number>>({})

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null
  const openThreadIds = [...new Set(Object.values(windowToThread))]
  const getThread = useCallback((threadId: string) => threads.find((t) => t.id === threadId), [threads])

  useEffect(() => {
    if (!activeRepo) return
    let running = true
    window.cranberri.codex.start(activeRepo.path).catch((err) => {
      if (running) console.error('Failed to set active Codex cwd:', err)
    })
    return () => {
      running = false
    }
  }, [activeRepo])

  const streamMessageText = useCallback((threadId: string, itemId: string, text: string, role: 'assistant' | 'reasoning') => {
    if (streamTimersRef.current[itemId]) {
      window.clearInterval(streamTimersRef.current[itemId])
      delete streamTimersRef.current[itemId]
    }

    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      const thread = { ...next[idx] }
      const existing = thread.messages.find((message) => message.id === itemId)
      thread.messages = existing
        ? thread.messages.map((message) => message.id === itemId ? { ...message, role, content: text } : message)
        : [...thread.messages, { id: itemId, role, content: text, timestamp: Date.now() }]
      next[idx] = thread
      return next
    })
  }, [])

  useEffect(() => {
    return window.cranberri.codex.onEvent((event) => {
      const e = event as CodexEvent
      logRendererTelemetry('codex:event:received', e)
      if (e.type === 'log') {
        console.log(`[codex ${e.level}]`, e.text)
        return
      }
      const threadId = (e as { threadId?: string }).threadId
      if (!threadId) return

      if (e.type === 'agent_message_delta') {
        return
      }

      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === threadId)
        if (idx === -1) return prev
        const next = [...prev]
        const thread = { ...next[idx] }

        switch (e.type) {
          case 'thread_name_updated':
            thread.title = e.title
            break
          case 'agent_message_completed':
            if (e.text) {
              thread.currentActivity = 'Writing'
              const role = e.phase === 'final_answer' ? 'assistant' : 'reasoning'
              queueMicrotask(() => streamMessageText(threadId, e.itemId, e.text, role))
            }
            break
          case 'tool_call':
            thread.currentActivity = `Calling ${e.tool.function}`
            break
          case 'approval_request':
            thread.currentActivity = 'Waiting for approval'
            thread.pendingApprovals = [...thread.pendingApprovals, e.approval]
            break
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
            const existing = [...thread.messages]
              .reverse()
              .find((message) => message.role !== 'user' && (message.content === e.text || e.text.startsWith(message.content) || message.content.startsWith(e.text)))
            const itemId = existing?.id ?? crypto.randomUUID()
            thread.lastRunDurationMs = thread.runStartedAt ? Date.now() - thread.runStartedAt : undefined
            queueMicrotask(() => streamMessageText(threadId, itemId, e.text, 'assistant'))
            break
          }
        }

        next[idx] = thread
        logRendererTelemetry('thread:after-event', {
          eventType: e.type,
          thread: summarizeThread(thread),
          openThreadIds: Object.values(windowToThread),
          activeThreadId,
        })
        return next
      })
    })
  }, [streamMessageText, windowToThread, activeThreadId])

  const getThreadForWindow = useCallback((windowId: string) => windowToThread[windowId], [windowToThread])

  const closeThreadWindow = useCallback((windowId: string) => {
    setWindowToThread((prev) => {
      if (!prev[windowId]) return prev
      const { [windowId]: closedThreadId, ...next } = prev
      setActiveThreadId((current) => current === closedThreadId ? (Object.values(next)[0] ?? null) : current)
      return next
    })
  }, [])

  const createThread = useCallback(async (windowId: string, initialContent?: string): Promise<CodexThread> => {
    if (!activeRepo) throw new Error('No active repo')
    const { threadId } = await window.cranberri.codex.createThread(activeRepo.path)
    const thread: CodexThread = {
      id: threadId,
      title: 'New thread',
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
      await window.cranberri.codex.sendMessage(activeRepo.path, threadId, initialContent)
    }
    return thread
  }, [activeRepo])

  const sendMessage = useCallback(async (threadId: string, content: string, settings?: CodexTurnSettings): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')

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
    await window.cranberri.codex.sendMessage(activeRepo.path, threadId, content, settings)
  }, [activeRepo])

  const compactThread = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    await window.cranberri.codex.compactThread(activeRepo.path, threadId)
  }, [activeRepo])

  const approve = useCallback(async (threadId: string, approvalId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        pendingApprovals: next[idx].pendingApprovals.filter((a) => a.id !== approvalId),
        isRunning: true,
        currentActivity: 'Working',
        runStartedAt: next[idx].runStartedAt ?? Date.now(),
      }
      return next
    })
    await window.cranberri.codex.approve(activeRepo.path, threadId, approvalId)
  }, [activeRepo])

  const abort = useCallback(async (threadId: string): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')
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
