import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { handoffRecoveryCommand, reconcileTaskStore } from './task-recovery'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => execFileSync('/usr/bin/trash', [root])))

describe('task startup recovery', () => {
  it.each([
    ['preflight', 'discard'],
    ['captured', 'discard'],
    ['branchReleased', 'rollback'],
    ['applied', 'rollback'],
    ['resumed', 'rollback'],
    ['rollback', 'rollback'],
    ['needsAttention', 'rollback'],
  ] as const)('recommends %s handoff recovery as %s', (phase, command) => {
    expect(handoffRecoveryCommand(phase)).toBe(command)
  })

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
    expect(recovered.tasks[2].pendingFirstTurn?.delivery).toBe('sending')
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
    await store.update((state) => ({
      ...state,
      tasks: [control('kept', 'thread-1'), control('empty', null)],
      localLeaseByProjectId: { project: 'kept' },
    }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks).toEqual([
      expect.objectContaining({ id: 'kept', threadId: 'thread-1', role: 'root', location: 'local' }),
    ])
    expect(store.read().localLeaseByProjectId.project).toBeNull()
  })

  it('recreates an empty prepared thread after restart before retrying its first turn', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'pending', projectId: 'project', threadId: 'empty-thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'local', baseRef: 'refs/heads/main', baseSha: null,
      environmentId: null, environmentRevision: null,
      pendingFirstTurn: { payload: { input: [{ type: 'text', text: 'retry me' }] }, delivery: 'pending' },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      threadId: null,
      pendingFirstTurn: { delivery: 'pending' },
      updatedAt: 10,
    })
  })

  it('restores a pre-provisioning Local binding after restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'local', projectId: 'project', threadId: 'thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'provisioning', baseRef: 'refs/heads/feature', baseSha: null,
      environmentId: 'node', environmentRevision: 'a'.repeat(64), pendingFirstTurn: null,
      worktreeTransition: {
        phase: 'provisioning', previousCheckoutId: 'local', previousBaseRef: 'refs/heads/main',
        previousBaseSha: null, previousEnvironmentId: null, previousEnvironmentRevision: null,
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      location: 'local', state: 'local', checkoutId: 'local', baseRef: 'refs/heads/main',
      environmentId: null, environmentRevision: null, worktreeTransition: null,
    })
  })

  it('recovers a worktree created before its task binding persisted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const worktreePath = path.join(root, 'worktree')
    fs.mkdirSync(worktreePath)
    await store.update((state) => ({ ...state, tasks: [{
      id: 'task', projectId: 'project', threadId: 'thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'provisioning', baseRef: 'refs/heads/main', baseSha: null,
      environmentId: null, environmentRevision: null, pendingFirstTurn: null,
      worktreeTransition: {
        phase: 'resuming', previousCheckoutId: 'local', previousBaseRef: 'refs/heads/main',
        previousBaseSha: null, previousEnvironmentId: null, previousEnvironmentRevision: null,
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }], managedWorktrees: [{
      id: 'worktree', projectId: 'project', checkoutId: 'managed', taskId: 'task', path: worktreePath,
      recordedRoot: root, gitCommonDir: root, manifestPath: path.join(root, 'manifest.json'),
      baseRef: 'refs/heads/main', baseSha: 'a'.repeat(40), branch: null, headSha: 'a'.repeat(40),
      archiveHeadSha: null, privateRef: null, lifecycle: 'active', cleanupReason: null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      checkoutId: 'managed', worktreeId: 'worktree', location: 'worktree', state: 'needsAttention',
      worktreeTransition: { phase: 'needsAttention', error: expect.stringContaining('before binding') },
    })
  })

  it('does not create another store revision after recovery has settled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: null } }))

    await reconcileTaskStore(store, 10)
    const revision = store.read().revision
    await reconcileTaskStore(store, 20)

    expect(store.read().revision).toBe(revision)
  })

  it('preserves interrupted handoff phase during startup reconciliation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'handoff', projectId: 'project', threadId: 'thread', checkoutId: 'managed', worktreeId: 'worktree',
      role: 'root', location: 'worktree', state: 'handingOff', baseRef: 'refs/heads/feature', baseSha: 'a'.repeat(40),
      environmentId: null, environmentRevision: null, pendingFirstTurn: null,
      handoff: {
        direction: 'toLocal', phase: 'captured', branch: 'feature', bundlePath: path.join(root, 'bundle.json'),
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    const result = await reconcileTaskStore(store, 10)

    expect(result.handoffRecoveries).toEqual([{
      taskId: 'handoff', phase: 'captured', command: 'discard',
    }])
    expect(store.read().tasks[0]).toMatchObject({
      state: 'handingOff', handoff: { phase: 'captured' }, updatedAt: 1,
    })
  })

})
