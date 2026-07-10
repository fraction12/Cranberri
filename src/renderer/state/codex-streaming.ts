import type { CodexMessage, CodexThread } from '../../shared/codex'

export interface StreamingMessageUpdate {
  threadId: string
  itemId: string
  role: 'assistant' | 'reasoning'
  text: string
  pending: boolean
}

export function streamingMessageKey(threadId: string, itemId: string): string {
  return JSON.stringify([threadId, itemId])
}

export function applyStreamingMessageUpdates(
  threads: CodexThread[],
  updates: StreamingMessageUpdate[],
): CodexThread[] {
  if (updates.length === 0) return threads

  const updatesByThread = new Map<string, StreamingMessageUpdate[]>()
  for (const update of updates) {
    const existing = updatesByThread.get(update.threadId)
    if (existing) existing.push(update)
    else updatesByThread.set(update.threadId, [update])
  }

  let changed = false
  const nextThreads = threads.map((thread) => {
    const threadUpdates = updatesByThread.get(thread.id)
    if (!threadUpdates) return thread

    let messages = thread.messages
    for (const update of threadUpdates) {
      const index = messages.findIndex((message) => message.id === update.itemId)
      if (index === -1) {
        if (messages === thread.messages) messages = [...messages]
        messages.push({
          id: update.itemId,
          role: update.role,
          content: update.text,
          timestamp: Date.now(),
          pending: update.pending,
        })
        continue
      }

      const current = messages[index]
      if (
        current.role === update.role
        && current.content === update.text
        && Boolean(current.pending) === update.pending
      ) {
        continue
      }

      if (messages === thread.messages) messages = [...messages]
      const nextMessage: CodexMessage = {
        ...current,
        role: update.role,
        content: update.text || current.content,
        pending: update.pending,
      }
      messages[index] = nextMessage
    }

    if (messages === thread.messages) return thread
    changed = true
    return { ...thread, messages }
  })

  return changed ? nextThreads : threads
}
