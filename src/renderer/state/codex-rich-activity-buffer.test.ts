import { describe, expect, it } from 'vitest'
import type { CodexThread } from '../../shared/codex'
import { applyCodexItemLifecycle, reconcileCodexTurnStarted } from './codex-turn-activity'
import {
  codexActivityTurnDiff,
  discardCodexRichActivityEvents,
  flushCodexRichActivityEvents,
  queueCodexRichActivityEvent,
  type CodexRichActivityBuffer,
} from './codex-rich-activity-buffer'

function thread(id: string): CodexThread {
  return {
    id,
    title: id,
    repoId: 'repo-1',
    messages: [],
    activityTurns: [{ id: 'turn-1', status: 'running', startedAt: 1_000, items: [] }],
    pendingApprovals: [],
    isRunning: true,
  }
}

describe('Codex rich activity buffer', () => {
  it('buffers progress before start and replays it after the owning item appears', () => {
    const initial = thread('thread-1')
    const queued = queueCodexRichActivityEvent([], {
      type: 'item_progress',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      progress: { type: 'command_output', delta: 'early output\n' },
    })

    const early = flushCodexRichActivityEvents([initial], queued)
    expect(early.threads).toBe(early.threads)
    expect(early.threads[0]).toBe(initial)
    expect(early.pending).toEqual(queued)

    const started = applyCodexItemLifecycle(initial, 'turn-1', {
      id: 'command-1',
      type: 'commandExecution',
      command: 'npm test',
      status: 'inProgress',
    }, 'started', 1_100)
    const replayed = flushCodexRichActivityEvents([started], early.pending)

    expect(replayed.pending).toEqual([])
    expect(replayed.threads[0].activityTurns![0].items[0].activityDetail).toMatchObject({
      type: 'commandExecution',
      aggregatedOutput: 'early output\n',
    })
  })

  it('routes activity by full thread, turn, and item identity', () => {
    const first = applyCodexItemLifecycle(thread('thread-1'), 'turn-1', {
      id: 'command-1',
      type: 'commandExecution',
      command: 'first',
      status: 'inProgress',
    }, 'started', 1_100)
    const second = applyCodexItemLifecycle(thread('thread-2'), 'turn-1', {
      id: 'command-1',
      type: 'commandExecution',
      command: 'second',
      status: 'inProgress',
    }, 'started', 1_100)
    const queued = queueCodexRichActivityEvent([], {
      type: 'item_progress',
      threadId: 'thread-2',
      turnId: 'turn-1',
      itemId: 'command-1',
      progress: { type: 'command_output', delta: 'second only' },
    })

    const result = flushCodexRichActivityEvents([first, second], queued)

    expect(result.threads[0]).toBe(first)
    expect(result.threads[0].activityTurns![0].items[0].activityDetail).not.toHaveProperty('aggregatedOutput')
    expect(result.threads[1].activityTurns![0].items[0].activityDetail).toMatchObject({
      aggregatedOutput: 'second only',
    })
  })

  it('coalesces authoritative turn diffs and replays them after turn start', () => {
    const withoutTurn = { ...thread('thread-1'), activityTurns: [] }
    let queued: CodexRichActivityBuffer = []
    queued = queueCodexRichActivityEvent(queued, {
      type: 'turn_diff_updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      diff: 'old diff',
    })
    queued = queueCodexRichActivityEvent(queued, {
      type: 'turn_diff_updated',
      threadId: 'thread-1',
      turnId: 'turn-1',
      diff: 'latest diff',
    })

    expect(queued).toHaveLength(1)
    const early = flushCodexRichActivityEvents([withoutTurn], queued)
    expect(early.pending).toHaveLength(1)

    const started = reconcileCodexTurnStarted(withoutTurn, 'turn-1', 1_000)
    const replayed = flushCodexRichActivityEvents([started], early.pending)

    expect(replayed.pending).toEqual([])
    expect(codexActivityTurnDiff(replayed.threads[0].activityTurns![0])).toBe('latest diff')
  })

  it('discards item and turn buffers at lifecycle boundaries', () => {
    const command = {
      type: 'item_progress' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      progress: { type: 'command_output' as const, delta: 'output' },
    }
    const other = { ...command, itemId: 'command-2' }
    const diff = {
      type: 'turn_diff_updated' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      diff: 'patch',
    }
    const queued = [command, other, diff]

    expect(discardCodexRichActivityEvents(queued, {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
    })).toEqual([other, diff])
    expect(discardCodexRichActivityEvents(queued, {
      threadId: 'thread-1',
      turnId: 'turn-1',
    })).toEqual([])
    expect(discardCodexRichActivityEvents([
      ...queued,
      { ...other, threadId: 'thread-2' },
    ], {
      threadId: 'thread-1',
    })).toEqual([{ ...other, threadId: 'thread-2' }])
  })
})
