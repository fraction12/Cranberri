import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../shared/tasks'
import { observeTaskLifecycleTelemetry } from './task-lifecycle-telemetry'
import { TaskStore } from './task-store'

const roots: string[] = []

function fixture(): { store: TaskStore; task: Task } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-lifecycle-telemetry-'))
  roots.push(root)
  return {
    store: new TaskStore(path.join(root, 'tasks.json')),
    task: {
      id: 'task-1', projectId: 'project-1', threadId: 'thread-1', checkoutId: 'checkout-1',
      worktreeId: 'worktree-1', role: 'root', location: 'worktree', state: 'active',
      baseRef: 'refs/heads/main', baseSha: 'a'.repeat(40), environmentId: null,
      environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('task lifecycle telemetry', () => {
  it('projects ordered lifecycle transitions without receipt paths or contents', async () => {
    const { store, task } = fixture()
    await store.update((state) => ({ ...state, tasks: [task] }))
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const observer = observeTaskLifecycleTelemetry(store, async (type, payload) => {
      events.push({ type, payload })
    })

    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: task.id, worktreeId: task.worktreeId, artifactId: 'artifact-1', startedAt: 100,
    })
    await store.appendLifecycleReceipt(operation.id, {
      phase: 'sourceNormalization',
      subphase: 'sourceNormalizationPlanned',
      recordedAt: 120,
      receiptId: `${operation.id}:normalization`,
      details: {
        sourcePath: '/Users/example/private/worktree',
        quarantinePath: '/Users/example/private/quarantine',
      },
    })
    await store.updateLifecycleOperation(operation.id, (current) => ({
      ...current,
      status: 'needsAttention',
      phase: 'needsAttention',
      retry: { ...current.retry, attempt: 1 },
      updatedAt: 140,
      lastError: {
        code: 'WORKTREE_CLEANUP_BLOCKED',
        message: 'Cannot quarantine node_modules/.bin/acorn at /Users/example/private/worktree/node_modules',
        recordedAt: 140,
      },
    }))
    await store.updateLifecycleOperation(operation.id, (current) => ({
      ...current,
      status: 'completed',
      phase: 'archived',
      updatedAt: 180,
      lastError: null,
    }))
    await observer.flush()
    observer.dispose()

    expect(events.map((event) => event.type)).toEqual([
      'task:lifecycle:started',
      'task:lifecycle:receipt',
      'task:lifecycle:needs-attention',
      'task:lifecycle:completed',
    ])
    expect(events[0]?.payload).toMatchObject({
      operationId: operation.id,
      kind: 'archive',
      taskId: task.id,
      projectId: task.projectId,
      worktreeId: task.worktreeId,
      threadId: task.threadId,
      status: 'pending',
      phase: 'intentPersisted',
    })
    expect(events[1]?.payload).toMatchObject({
      operationId: operation.id,
      subphase: 'sourceNormalizationPlanned',
      phase: 'sourceNormalization',
    })
    expect(JSON.stringify(events[1]?.payload)).not.toContain('/Users/example')
    expect(events[2]?.payload).toMatchObject({
      errorCode: 'WORKTREE_CLEANUP_BLOCKED',
      errorMessage: 'Cannot quarantine node_modules/.bin/acorn at [path]',
      retryAttempt: 1,
    })
    expect(JSON.stringify(events[2]?.payload)).not.toContain('/Users/example')
    expect(events[3]?.payload).toMatchObject({ durationMs: 80, status: 'completed', phase: 'archived' })
  })

  it('observes unfinished operations before startup recovery mutates them', async () => {
    const { store, task } = fixture()
    await store.update((state) => ({ ...state, tasks: [task] }))
    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: task.id, worktreeId: task.worktreeId, artifactId: 'artifact-1', startedAt: 100,
    })
    await store.updateLifecycleOperation(operation.id, (current) => ({
      ...current, status: 'running', phase: 'threadArchived', updatedAt: 150,
    }))
    const emit = vi.fn(async () => undefined)

    const observer = observeTaskLifecycleTelemetry(store, emit)
    await observer.flush()
    observer.dispose()

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith('task:lifecycle:recovery-observed', expect.objectContaining({
      operationId: operation.id,
      status: 'running',
      phase: 'threadArchived',
    }))
  })

  it('keeps task-store commits independent from telemetry failures', async () => {
    const { store, task } = fixture()
    await store.update((state) => ({ ...state, tasks: [task] }))
    const observer = observeTaskLifecycleTelemetry(store, async () => {
      throw new Error('telemetry unavailable')
    })

    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: task.id, worktreeId: task.worktreeId, artifactId: 'artifact-1', startedAt: 100,
    })
    await observer.flush()
    observer.dispose()

    expect(store.read().lifecycleOperations).toEqual([expect.objectContaining({ id: operation.id })])
  })
})
