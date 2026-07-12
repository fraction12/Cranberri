import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { reconcileTaskStore } from './task-recovery'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('task startup recovery', () => {
  it('makes interrupted work retryable and releases stale Local leases', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const task = (id: string, state: 'provisioning' | 'setup' | 'active') => ({
      id, projectId: 'project', threadId: null, checkoutId: 'local', worktreeId: null,
      role: 'root' as const, location: 'worktree' as const, state, baseRef: 'main', baseSha: null,
      environmentId: null, environmentRevision: null,
      pendingFirstTurn: state === 'active' ? { payload: { input: [{ type: 'text', text: 'keep' }] }, delivery: 'sending' as const } : null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    })
    await store.update((state) => ({
      ...state,
      tasks: [task('draft', 'provisioning'), task('setup', 'setup'), task('sending', 'active')],
      localLeaseByProjectId: { project: 'sending' },
      interruptedOperations: [{ taskId: 'missing', operation: 'create' }],
    }))

    await reconcileTaskStore(store, 10)
    const recovered = store.read()
    expect(recovered.tasks.map((candidate) => candidate.state)).toEqual(['draft', 'failed', 'active'])
    expect(recovered.tasks[2].pendingFirstTurn?.delivery).toBe('pending')
    expect(recovered.localLeaseByProjectId.project).toBeNull()
    expect(recovered.interruptedOperations).toEqual([])
  })

  it('preserves control-task history as a normal Local session and drops empty controls', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const control = (id: string, threadId: string | null) => ({
      id, projectId: 'project', threadId, checkoutId: 'local', worktreeId: null,
      role: 'control' as const, location: 'local' as const, state: 'local' as const,
      baseRef: 'refs/heads/main', baseSha: null, environmentId: null,
      environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1,
      archivedAt: null,
    })
    await store.update((state) => ({ ...state, tasks: [control('kept', 'thread-1'), control('empty', null)] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks).toEqual([
      expect.objectContaining({ id: 'kept', threadId: 'thread-1', role: 'root', location: 'local' }),
    ])
  })
})
