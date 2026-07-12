import { describe, expect, it } from 'vitest'
import type { CodexThread } from '@/shared/codex'
import { applyCodexSendFailure } from './codex-send-failure'

describe('applyCodexSendFailure', () => {
  it('returns a rejected turn to idle and preserves the error in the transcript', () => {
    const thread: CodexThread = {
      id: 'thread-1',
      title: 'Thread',
      repoId: 'repo-1',
      messages: [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1 }],
      pendingApprovals: [],
      isRunning: true,
      currentActivity: 'Working',
    }

    expect(applyCodexSendFailure(thread, 'model unavailable', 'error-1', 2)).toEqual({
      ...thread,
      isRunning: false,
      currentActivity: undefined,
      messages: [
        ...thread.messages,
        { id: 'error-1', role: 'system', content: 'Error: model unavailable', timestamp: 2 },
      ],
    })
  })

  it('settles an optimistic activity turn with an inline failure', () => {
    const thread: CodexThread = {
      id: 'thread-1',
      title: 'Thread',
      repoId: 'repo-1',
      messages: [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1, turnId: 'local:user-1' }],
      activityTurns: [{ id: 'local:user-1', status: 'running', startedAt: 1, items: [] }],
      pendingApprovals: [],
      isRunning: true,
    }

    const result = applyCodexSendFailure(thread, 'model unavailable', 'error-1', 10)

    expect(result.activityTurns?.[0]).toMatchObject({
      status: 'failed',
      completedAt: 10,
      items: [expect.objectContaining({ status: 'failed', title: 'Turn failed', detail: 'model unavailable' })],
    })
    expect(result.messages).toEqual(thread.messages)
  })
})
