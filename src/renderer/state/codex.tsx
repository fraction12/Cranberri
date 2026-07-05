import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { CodexEvent, CodexThread } from '@/shared/codex'
import { useRepos } from './repos'

interface CodexApi {
  threads: CodexThread[]
  activeThreadId: string | null
  activeThread: CodexThread | null
  getThread: (threadId: string) => CodexThread | undefined
  createThread: (windowId: string, initialContent?: string) => Promise<CodexThread>
  sendMessage: (content: string) => Promise<void>
  approve: (approvalId: string) => Promise<void>
  abort: () => Promise<void>
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
          case 'text': {
            const last = thread.messages.at(-1)
            if (last && last.role === 'assistant') {
              last.content += e.text
            } else {
              thread.messages = [...thread.messages, {
                id: crypto.randomUUID(),
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

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (!activeRepo || !activeThread) throw new Error('No active repo or thread')

    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === activeThread.id)
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

    await window.cranberri.codex.sendMessage(activeRepo.path, activeThread.id, content)
  }, [activeRepo, activeThread])

  const approve = useCallback(async (approvalId: string): Promise<void> => {
    if (!activeRepo || !activeThread) throw new Error('No active repo or thread')
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === activeThread.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        pendingApprovals: next[idx].pendingApprovals.filter((a) => a.id !== approvalId),
        isRunning: true,
      }
      return next
    })
    await window.cranberri.codex.approve(activeRepo.path, activeThread.id, approvalId)
  }, [activeRepo, activeThread])

  const abort = useCallback(async (): Promise<void> => {
    if (!activeRepo || !activeThread) throw new Error('No active repo or thread')
    await window.cranberri.codex.interrupt(activeRepo.path, activeThread.id)
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === activeThread.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], isRunning: false }
      return next
    })
  }, [activeRepo, activeThread])

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
