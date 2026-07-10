import { describe, expect, it } from 'vitest'
import type { CodexThread } from '../../shared/codex'
import { applyStreamingMessageUpdates, streamingMessageKey } from './codex-streaming'

function thread(id: string): CodexThread {
  return {
    id,
    title: id,
    repoId: 'repo-1',
    messages: [],
    pendingApprovals: [],
    isRunning: true,
  }
}

describe('applyStreamingMessageUpdates', () => {
  it('keeps thread and item identifier boundaries unambiguous', () => {
    expect(streamingMessageKey('thread:item', 'message')).not.toBe(
      streamingMessageKey('thread', 'item:message'),
    )
  })

  it('applies a frame of updates while preserving unaffected thread identity', () => {
    const active = thread('thread-1')
    const inactive = thread('thread-2')
    const threads = [active, inactive]
    const result = applyStreamingMessageUpdates(threads, [
      { threadId: active.id, itemId: 'message-1', role: 'assistant', text: 'Hello', pending: true },
      { threadId: active.id, itemId: 'message-2', role: 'reasoning', text: 'Thinking', pending: true },
    ])

    expect(result).not.toBe(threads)
    expect(result[0].messages).toEqual([
      expect.objectContaining({ id: 'message-1', role: 'assistant', content: 'Hello', pending: true }),
      expect.objectContaining({ id: 'message-2', role: 'reasoning', content: 'Thinking', pending: true }),
    ])
    expect(result[1]).toBe(inactive)
  })

  it('returns the existing thread list when a repeated frame has no changes', () => {
    const active = thread('thread-1')
    active.messages = [{
      id: 'message-1',
      role: 'assistant',
      content: 'Hello',
      timestamp: 1,
      pending: true,
    }]
    const threads = [active]

    expect(applyStreamingMessageUpdates(threads, [
      { threadId: active.id, itemId: 'message-1', role: 'assistant', text: 'Hello', pending: true },
    ])).toBe(threads)
  })

  it('can complete a message without a preceding delta', () => {
    const active = thread('thread-1')
    const result = applyStreamingMessageUpdates([active], [
      { threadId: active.id, itemId: 'message-1', role: 'assistant', text: 'Done', pending: false },
    ])

    expect(result[0].messages[0]).toEqual(expect.objectContaining({
      id: 'message-1',
      content: 'Done',
      pending: false,
    }))
  })
})
