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
})
