import { describe, expect, it } from 'vitest'
import {
  countActiveCodexWorkers,
  mergeCodexWorker,
  workersFromSessionThread,
  workersFromThreadItem,
} from './codex-workers'

describe('Codex worker normalization', () => {
  it('counts only workers whose lifecycle is active', () => {
    expect(countActiveCodexWorkers([
      { threadId: 'pending', parentThreadId: 'parent', status: 'pendingInit', updatedAt: 1 },
      { threadId: 'running', parentThreadId: 'parent', status: 'running', updatedAt: 2 },
      { threadId: 'completed', parentThreadId: 'parent', status: 'completed', updatedAt: 3 },
      { threadId: 'idle', parentThreadId: 'parent', status: 'idle', updatedAt: 4 },
    ])).toBe(2)
    expect(countActiveCodexWorkers(undefined)).toBe(0)
  })

  it('turns a spawn tool call into a pending worker with its launch metadata', () => {
    expect(workersFromThreadItem('parent-1', {
      id: 'spawn-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      status: 'inProgress',
      senderThreadId: 'parent-1',
      receiverThreadIds: ['worker-1'],
      prompt: 'Inspect the renderer state.',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    }, 100)).toEqual([expect.objectContaining({
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      status: 'pendingInit',
      prompt: 'Inspect the renderer state.',
      lastInstruction: 'Inspect the renderer state.',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      updatedAt: 100,
    })])
  })

  it('uses authoritative agent states from completed collab calls', () => {
    expect(workersFromThreadItem('parent-1', {
      type: 'collabAgentToolCall',
      tool: 'wait',
      status: 'completed',
      senderThreadId: 'parent-1',
      receiverThreadIds: ['worker-1'],
      agentsStates: {
        'worker-1': { status: 'errored', message: 'Tests failed' },
      },
    }, 200)[0]).toMatchObject({ status: 'errored', message: 'Tests failed' })
  })

  it('preserves multiple receivers and subagent activity relationships', () => {
    const workers = workersFromThreadItem('parent-1', {
      type: 'collabAgentToolCall',
      tool: 'sendInput',
      status: 'completed',
      senderThreadId: 'worker-parent',
      receiverThreadIds: ['worker-1', 'worker-2'],
      prompt: 'Recheck the tests.',
    }, 300)

    expect(workers).toEqual([
      expect.objectContaining({ threadId: 'worker-1', parentThreadId: 'worker-parent', status: 'running' }),
      expect.objectContaining({ threadId: 'worker-2', parentThreadId: 'worker-parent', status: 'running' }),
    ])
    expect(workersFromThreadItem('worker-parent', {
      type: 'subAgentActivity',
      kind: 'interrupted',
      agentThreadId: 'worker-1',
      agentPath: 'Euclid',
    }, 400)[0]).toMatchObject({ status: 'interrupted', agentPath: 'Euclid' })
  })

  it('accepts the newer collabToolCall wire shape', () => {
    expect(workersFromThreadItem('parent-1', {
      type: 'collabToolCall',
      tool: 'spawn_agent',
      status: 'completed',
      senderThreadId: 'parent-1',
      newThreadId: 'worker-new',
      prompt: 'Inspect the app-server bridge.',
      agentStatus: { status: 'running', message: 'Reading protocol' },
    }, 500)[0]).toMatchObject({
      threadId: 'worker-new',
      parentThreadId: 'parent-1',
      prompt: 'Inspect the app-server bridge.',
      status: 'running',
      message: 'Reading protocol',
    })
  })

  it('reconstructs and merges worker lifecycle from historical thread items', () => {
    const workers = workersFromSessionThread({
      id: 'parent-1',
      updatedAt: 3,
      turns: [{
        id: 'turn-1',
        startedAt: 1,
        completedAt: 2,
        items: [
          {
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            senderThreadId: 'parent-1',
            receiverThreadIds: ['worker-1'],
            prompt: 'Review the diff.',
          },
          {
            type: 'collabAgentToolCall',
            tool: 'wait',
            status: 'completed',
            senderThreadId: 'parent-1',
            receiverThreadIds: ['worker-1'],
            agentsStates: { 'worker-1': { status: 'completed', message: 'Review complete' } },
          },
        ],
      }],
    })

    expect(workers).toEqual([expect.objectContaining({
      threadId: 'worker-1',
      status: 'completed',
      message: 'Review complete',
      prompt: 'Review the diff.',
    })])
  })

  it('preserves item order when a completed worker is resumed in the same turn', () => {
    const workers = workersFromSessionThread({
      id: 'parent-1',
      updatedAt: 2,
      turns: [{
        id: 'turn-1',
        completedAt: 2,
        items: [
          {
            type: 'collabAgentToolCall',
            tool: 'wait',
            status: 'completed',
            senderThreadId: 'parent-1',
            receiverThreadIds: ['worker-1'],
            agentsStates: { 'worker-1': { status: 'completed', message: 'Done' } },
          },
          {
            type: 'collabAgentToolCall',
            tool: 'resumeAgent',
            status: 'completed',
            senderThreadId: 'parent-1',
            receiverThreadIds: ['worker-1'],
            prompt: 'Take another pass.',
          },
        ],
      }],
    })

    expect(workers[0]).toMatchObject({ status: 'running', lastInstruction: 'Take another pass.' })
  })

  it('does not let an older running event replace a newer terminal state', () => {
    const merged = mergeCodexWorker({
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      status: 'completed',
      message: 'Done',
      updatedAt: 200,
    }, {
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      nickname: 'Euclid',
      status: 'running',
      updatedAt: 100,
    })

    expect(merged).toMatchObject({ status: 'completed', message: 'Done', nickname: 'Euclid', updatedAt: 200 })
  })
})
