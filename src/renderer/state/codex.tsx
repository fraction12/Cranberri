import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { CodexEvent, CodexThread } from '@/shared/codex'
import { useRepos } from './repos'

interface CodexApi {
  threads: CodexThread[]
  activeThreadId: string | null
  activeThread: CodexThread | null
  getThread: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string) => Promise<CodexThread>
  sendMessage: (threadId: string, content: string) => Promise<void>
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
          case 'agent_message_delta': {
            const existing = thread.messages.find((message) => message.id === e.itemId)
            if (existing) {
              existing.content += e.delta
            } else {
              thread.messages = [...thread.messages, {
                id: e.itemId,
                role: 'assistant',
                content: e.delta,
                timestamp: Date.now(),
              }]
            }
            break
          }
          case 'agent_message_completed': {
            const existing = thread.messages.find((message) => message.id === e.itemId)
            if (existing) {
              existing.content = e.text
            } else if (e.text) {
              thread.messages = [...thread.messages, {
                id: e.itemId,
                role: 'assistant',
                content: e.text,
                timestamp: Date.now(),
              }]
            }
            break
          }
          case 'tool_call':
            thread.messages = [...thread.messages, {
              id: crypto.randomUUID(),
              role: 'system',
              content: `Tool call: ${e.tool.function}`,
              timestamp: Date.now(),
            }]
            break
          case 'approval_request':
            thread.pendingApprovals = [...thread.pendingApprovals, e.approval]
            break
          case 'run_start':
          case 'item_started':
            thread.isRunning = true
            break
          case 'run_end':
            thread.isRunning = false
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

        next[idx] = thread
        return next
      })
    })
  }, [])

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
    }
    setThreads((prev) => [...prev, thread])
    setActiveThreadId(threadId)
    setWindowToThread((prev) => ({ ...prev, [windowId]: threadId }))
    if (initialContent) {
      await window.cranberri.codex.sendMessage(activeRepo.path, threadId, initialContent)
    }
    return thread
  }, [activeRepo])

  const sendMessage = useCallback(async (threadId: string, content: string): Promise<void> => {
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
      }
      return next
    })

    await window.cranberri.codex.sendMessage(activeRepo.path, threadId, content)
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
      next[idx] = { ...next[idx], isRunning: false }
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
