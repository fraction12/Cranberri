import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { CodexEvent, CodexThread, CodexTurnSettings } from '@/shared/codex'
import { useRepos } from './repos'

interface CodexApi {
  threads: CodexThread[]
  activeThreadId: string | null
  activeThread: CodexThread | null
  getThread: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string) => Promise<CodexThread>
  sendMessage: (threadId: string, content: string, settings?: CodexTurnSettings) => Promise<void>
  approve: (threadId: string, approvalId: string) => Promise<void>
  abort: (threadId: string) => Promise<void>
  switchThread: (threadId: string) => void
  getThreadForWindow: (windowId: string) => string | undefined
}

const CodexContext = createContext<CodexApi | null>(null)

export function CodexProvider({ children }: { children: React.ReactNode }) {
  const { activeRepo } = useRepos()
  const [threads, setThreads] = useState<CodexThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [windowToThread, setWindowToThread] = useState<Record<string, string>>({})
  const streamTimersRef = useRef<Record<string, number>>({})

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null
  const getThread = useCallback((threadId: string) => threads.find((t) => t.id === threadId), [threads])

  useEffect(() => {
    if (!activeRepo) return
    let running = true
    window.cranberri.codex.start(activeRepo.path).catch((err) => {
      if (running) console.error('Failed to start Codex session:', err)
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
      if (existing) {
        thread.messages = thread.messages.map((message) => message.id === itemId ? { ...message, role, content: '' } : message)
      } else {
        thread.messages = [...thread.messages, { id: itemId, role, content: '', timestamp: Date.now() }]
      }
      next[idx] = thread
      return next
    })

    let cursor = 0
    const step = () => {
      cursor = Math.min(text.length, cursor + Math.max(2, Math.ceil(text.length / 80)))
      const nextContent = text.slice(0, cursor)
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === threadId)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = {
          ...next[idx],
          messages: next[idx].messages.map((message) => message.id === itemId ? { ...message, content: nextContent } : message),
        }
        return next
      })
      if (cursor >= text.length) {
        window.clearInterval(streamTimersRef.current[itemId])
        delete streamTimersRef.current[itemId]
      }
    }

    step()
    streamTimersRef.current[itemId] = window.setInterval(step, 18)
  }, [])

  useEffect(() => {
    return window.cranberri.codex.onEvent((event) => {
      const e = event as CodexEvent
      if (e.type === 'log') {
        console.log(`[codex ${e.level}]`, e.text)
        return
      }
      const threadId = (e as { threadId?: string }).threadId
      if (!threadId) return

      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === threadId)
        if (idx === -1) return prev
        const next = [...prev]
        const thread = { ...next[idx] }

        switch (e.type) {
          case 'thread_name_updated':
            thread.title = e.title
            break
          case 'agent_message_delta':
            thread.currentActivity = 'Writing'
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
              thread.messages = thread.messages.map((m) =>
                m.role === 'compact' && m.pending
                  ? { ...m, content: e.state === 'completed' ? 'Context compacted' : `Compaction failed: ${e.message ?? e.state}`, pending: false }
                  : m
              )
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
        return next
      })
    })
  }, [streamMessageText])

  const getThreadForWindow = useCallback((windowId: string) => windowToThread[windowId], [windowToThread])

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
    if (initialContent) {
      await window.cranberri.codex.sendMessage(activeRepo.path, threadId, initialContent)
    }
    return thread
  }, [activeRepo])

  const sendMessage = useCallback(async (threadId: string, content: string, settings?: CodexTurnSettings): Promise<void> => {
    if (!activeRepo) throw new Error('No active repo')

    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        messages: [...next[idx].messages, {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          timestamp: Date.now(),
        }],
        isRunning: true,
        currentActivity: 'Working',
        runStartedAt: Date.now(),
        lastRunDurationMs: undefined,
      }
      return next
    })

    await window.cranberri.codex.sendMessage(activeRepo.path, threadId, content, settings)
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

  return (
    <CodexContext.Provider
      value={{ threads, activeThreadId, activeThread, getThread, createThread, sendMessage, approve, abort, switchThread, getThreadForWindow }}
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
