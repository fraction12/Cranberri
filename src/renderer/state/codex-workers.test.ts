import { describe, expect, it } from 'vitest'
import type { CodexSessionThread, CodexThread } from '@/shared/codex'
import { applyWorkerUpdate, hydrateSessionWorkerGraph, hydrateWorkersFromGraph, sessionWorkersForHydration, upsertWorkerGraph } from './codex-workers'

const parent: CodexThread = {
  id: 'parent-1',
  title: 'Parent',
  repoId: 'repo-1',
  messages: [],
  pendingApprovals: [],
  isRunning: false,
}

const child: CodexThread = {
  id: 'worker-1',
  title: 'Worker',
  repoId: 'repo-1',
  messages: [],
  pendingApprovals: [],
  isRunning: false,
}

describe('applyWorkerUpdate', () => {
  it('trusts normalized worker lifecycle over historical transcript inference', () => {
    const session: CodexSessionThread = {
      id: 'parent-1',
      title: 'Parent',
      preview: '',
      createdAt: 100,
      updatedAt: 300,
      archived: false,
      turnCount: 1,
      status: { type: 'notLoaded' },
      workers: [{
        threadId: 'worker-1',
        parentThreadId: 'parent-1',
        nickname: 'Euclid',
        status: 'completed',
        updatedAt: 300_001,
      }],
      turns: [{
        id: 'parent-turn',
        completedAt: 300,
        items: [{
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          status: 'completed',
          senderThreadId: 'parent-1',
          receiverThreadIds: ['worker-1'],
        }],
      }],
    }

    expect(sessionWorkersForHydration(session)).toEqual([
      expect.objectContaining({ threadId: 'worker-1', status: 'completed', nickname: 'Euclid' }),
    ])
  })

  it('retains a worker update before its parent task is hydrated', () => {
    const graph = upsertWorkerGraph({}, 'parent-later', {
      threadId: 'worker-early',
      parentThreadId: 'parent-later',
      status: 'running',
      updatedAt: 10,
    })

    expect(graph['parent-later']).toEqual([expect.objectContaining({ threadId: 'worker-early', status: 'running' })])
  })
  it('updates the parent graph and an opened worker transcript together', () => {
    const threads = applyWorkerUpdate([parent, child], 'parent-1', {
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      nickname: 'Euclid',
      role: 'explorer',
      status: 'running',
      message: 'Inspecting tests',
      updatedAt: 10,
    })

    expect(threads[0].workers).toEqual([expect.objectContaining({ status: 'running', nickname: 'Euclid' })])
    expect(threads[1]).toMatchObject({
      parentThreadId: 'parent-1',
      agentNickname: 'Euclid',
      agentRole: 'explorer',
      isRunning: true,
      currentActivity: 'Inspecting tests',
    })
  })

  it('clears the opened worker activity when the worker completes', () => {
    const threads = applyWorkerUpdate([{ ...parent, workers: [] }, { ...child, isRunning: true }], 'parent-1', {
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      status: 'completed',
      updatedAt: 20,
    })

    expect(threads[1]).toMatchObject({ isRunning: false, currentActivity: undefined })
  })

  it('propagates a nested worker update into the visible root tree', () => {
    const worker = {
      threadId: 'worker-1',
      parentThreadId: 'parent-1',
      status: 'running' as const,
      updatedAt: 10,
    }
    const nested = {
      threadId: 'worker-2',
      parentThreadId: 'worker-1',
      status: 'running' as const,
      updatedAt: 11,
    }
    let graph = upsertWorkerGraph({}, 'worker-1', nested)
    graph = upsertWorkerGraph(graph, 'parent-1', worker)

    expect(graph['parent-1'][0].workers).toEqual([expect.objectContaining({ threadId: 'worker-2' })])
    expect(hydrateWorkersFromGraph(graph, [worker])[0].workers).toEqual([
      expect.objectContaining({ threadId: 'worker-2', parentThreadId: 'worker-1' }),
    ])

    const threads = applyWorkerUpdate([{ ...parent, workers: [worker] }], 'worker-1', nested)
    expect(threads[0].workers?.[0].workers).toEqual([expect.objectContaining({ threadId: 'worker-2' })])
  })

  it('registers a worker opened directly from the session rail under its parent', () => {
    const graph = hydrateSessionWorkerGraph({}, {
      id: 'worker-rail',
      parentThreadId: 'parent-rail',
      agentNickname: 'Noether',
      title: 'Inspect rail state',
      preview: '',
      createdAt: 10,
      updatedAt: 20,
      archived: false,
      status: 'completed',
      turnCount: 1,
    }, [])

    expect(graph['parent-rail']).toEqual([
      expect.objectContaining({ threadId: 'worker-rail', nickname: 'Noether', status: 'completed' }),
    ])
  })
})
