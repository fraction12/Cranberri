import { describe, expect, it } from 'vitest'
import type { CodexThread } from '@/shared/codex'
import type { CodexPendingHumanServerRequest, CodexRequestOutcomeEntry } from '@/shared/codex-requests'
import {
  attachHumanRequestOutcomes,
  attachPendingHumanRequests,
  codexRequestKey,
  findPendingHumanRequest,
  removePendingHumanRequest,
  upsertHumanRequestOutcome,
  upsertPendingHumanRequest,
} from './codex-requests'

function pending(id: string | number, itemId = `item-${id}`): CodexPendingHumanServerRequest {
  return {
    request: {
      id,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId,
        startedAtMs: 100,
        reason: 'Allow file changes',
        grantRoot: null,
      },
    },
    attempt: 1,
    receivedAt: 100,
    deadlineAt: 1_000,
  }
}

function outcome(requestId: string, completedAt: number): CodexRequestOutcomeEntry {
  return {
    requestId,
    method: 'item/fileChange/requestApproval',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `item-${requestId}`,
    status: 'resolved',
    decision: { kind: 'accepted', scope: 'request', count: 1 },
    requestedAt: 100,
    completedAt,
    attempt: 1,
  }
}

function thread(): CodexThread {
  return {
    id: 'thread-1',
    title: 'Thread',
    repoId: 'repo-1',
    messages: [],
    pendingApprovals: [],
    isRunning: true,
  }
}

describe('Codex renderer human request state', () => {
  it('keeps string and numeric request ids distinct', () => {
    expect(codexRequestKey('42')).not.toBe(codexRequestKey(42))
  })

  it('upserts a retry without disturbing concurrent requests', () => {
    const first = pending('request-1')
    const concurrent = pending('request-2')
    const retry = { ...first, attempt: 2 }

    expect(upsertPendingHumanRequest([first, concurrent], retry)).toEqual([retry, concurrent])
  })

  it('removes only the correlated request', () => {
    const first = pending('request-1')
    const second = pending('request-2')

    expect(removePendingHumanRequest([first, second], 'request-1')).toEqual([second])
  })

  it('attaches buffered requests after thread hydration without losing existing requests', () => {
    const existing = pending('request-1')
    const buffered = pending('request-2')
    const hydrated = { ...thread(), pendingHumanRequests: [existing] }

    expect(attachPendingHumanRequests(hydrated, [buffered]).pendingHumanRequests).toEqual([existing, buffered])
  })

  it('requires both request identity and method before sending a response', () => {
    const target = pending('request-1')
    const targetThread = { ...thread(), pendingHumanRequests: [target] }
    const matching = {
      id: 'request-1',
      method: 'item/fileChange/requestApproval' as const,
      response: { decision: 'decline' as const },
    }
    const wrongMethod = {
      id: 'request-1',
      method: 'item/commandExecution/requestApproval' as const,
      response: { decision: 'decline' as const },
    }

    expect(findPendingHumanRequest(targetThread, matching)).toBe(target)
    expect(findPendingHumanRequest(targetThread, wrongMethod)).toBeUndefined()
  })

  it('rehydrates durable request outcomes in chronological order without duplicates', () => {
    const first = outcome('request-1', 200)
    const second = outcome('request-2', 300)
    const retry = { ...first, completedAt: 400, attempt: 2 }

    expect(upsertHumanRequestOutcome([first, second], retry)).toEqual([second, retry])
    expect(attachHumanRequestOutcomes(thread(), [second, first]).humanRequestOutcomes).toEqual([first, second])
  })
})
