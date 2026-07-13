import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRegistry } from '../shared/projects'
import { TaskStore } from './task-store'
import { assertTaskRunnable, TaskCoordinator } from './tasks'
import type { WorktreeLifecycle } from './worktree-lifecycle'
import { WorktreeSnapshotStore } from './worktree-snapshot-store'

const roots: string[] = []

function fixture(): { root: string; store: TaskStore; coordinator: TaskCoordinator } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-'))
  roots.push(root)
  const store = new TaskStore(path.join(root, 'tasks.json'))
  return { root, store, coordinator: new TaskCoordinator(store) }
}

const registry: ProjectRegistry = {
  version: 1,
  activeProjectId: 'project',
  projects: [{
    id: 'project', name: 'Project', gitCommonDir: '/repo/.git',
    localCheckoutId: 'local', pinnedLocalBranch: 'main', defaultEnvironmentId: null,
    controlTaskId: 'control-project', localLeaseTaskId: 'control-project',
  }],
  checkouts: [{
    id: 'local', projectId: 'project', kind: 'local', canonicalPath: '/repo',
    gitCommonDir: '/repo/.git', ownership: 'user', available: true,
  }],
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('TaskCoordinator', () => {
  it('creates ordinary visible Local tasks instead of a special control task', async () => {
    const { store, coordinator } = fixture()
    const created = await coordinator.createLocalTask({
      projectId: 'project', title: 'Investigate', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [{ type: 'text', text: 'Investigate' }],
    }, 10)

    expect(store.read().tasks).toEqual([created])
    expect(created).toMatchObject({
      role: 'root', location: 'local', state: 'local', baseRef: 'refs/heads/main',
      pendingFirstTurn: { delivery: 'pending' },
    })
  })

  it('adopts a Codex thread exactly once and rejects cross-project rebinding', async () => {
    const { store, coordinator } = fixture()
    const request = {
      projectId: 'project', title: 'Legacy', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    }

    const [first, second] = await Promise.all([
      coordinator.createLocalTask(request),
      coordinator.createLocalTask(request),
    ])

    expect(second.id).toBe(first.id)
    expect(store.read().tasks).toHaveLength(1)
    await expect(coordinator.createLocalTask({ ...request, projectId: 'other' }))
      .rejects.toThrow(/another project/)
  })

  it('persists the full first turn before provisioning', async () => {
    const { store, coordinator } = fixture()
    const task = await coordinator.createWorktreeDraft({
      projectId: 'project',
      title: 'Build it',
      baseRef: 'refs/heads/main',
      environmentId: 'node',
      environmentRevision: 'a'.repeat(64),
      input: [{ type: 'text', text: 'Build it' }],
    }, 10)

    expect(store.read().tasks[0]).toEqual(task)
    expect(task).toMatchObject({
      threadId: null,
      state: 'draft',
      pendingFirstTurn: { delivery: 'pending', payload: { input: [{ text: 'Build it' }] } },
    })
  })

  it('enforces one Local execution lease per project', async () => {
    const { store, coordinator } = fixture()
    await coordinator.acquireLocalLease('project', 'task-a')
    await expect(coordinator.acquireLocalLease('project', 'task-b')).rejects.toThrow(/in use/i)
    await coordinator.releaseLocalLease('project', 'task-a')
    expect(store.read().localLeaseByProjectId.project).toBeNull()
  })

  it('allows turns only in runnable Local or Worktree states', async () => {
    const { coordinator } = fixture()
    const local = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [{ type: 'text', text: 'Local' }],
    })

    expect(() => assertTaskRunnable(local)).not.toThrow()
    expect(() => assertTaskRunnable({ ...local, state: 'archived' })).toThrow(/archived/)
    expect(() => assertTaskRunnable({ ...local, location: 'worktree', state: 'failed' })).toThrow(/failed/)
    expect(() => assertTaskRunnable({ ...local, location: 'worktree', state: 'active' })).not.toThrow()
  })

  it('resolves cwd from authoritative checkout and worktree records', async () => {
    const { store, coordinator } = fixture()
    const local = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [{ type: 'text', text: 'Local' }],
    })
    await store.update((state) => ({
      ...state,
      tasks: [...state.tasks, {
        ...state.tasks[0], id: 'worktree-task', role: 'root', location: 'worktree',
        checkoutId: 'managed-checkout', worktreeId: 'worktree', state: 'active',
      }],
      managedWorktrees: [{
        id: 'worktree', projectId: 'project', taskId: 'worktree-task',
        checkoutId: 'managed-checkout', path: '/managed/task', recordedRoot: '/managed',
        gitCommonDir: '/repo/.git', manifestPath: '/managed/.cranberri/worktree.json',
        baseRef: 'refs/heads/main', baseSha: 'a'.repeat(40), branch: null,
        headSha: 'a'.repeat(40), archiveHeadSha: null, privateRef: null,
        lifecycle: 'active', cleanupReason: null, createdAt: 1, updatedAt: 1, archivedAt: null,
      }],
    }))

    expect(coordinator.resolveRuntime(local.id, registry).cwd).toBe('/repo')
    expect(coordinator.resolveRuntime('worktree-task', registry)).toMatchObject({
      cwd: '/managed/task', taskId: 'worktree-task',
    })
  })

  it('preserves a pending first turn until acknowledgement and restores it after failure', async () => {
    const { coordinator } = fixture()
    const task = await coordinator.createWorktreeDraft({
      projectId: 'project', title: 'Task', baseRef: 'refs/heads/main',
      environmentId: null, environmentRevision: null,
      input: [{ type: 'text', text: 'Keep me' }],
    })

    await coordinator.markPendingTurnSending(task.id)
    expect(coordinator.get(task.id).pendingFirstTurn?.delivery).toBe('sending')
    await coordinator.restorePendingTurn(task.id)
    expect(coordinator.get(task.id).pendingFirstTurn?.delivery).toBe('pending')
    await coordinator.replacePendingTurn(task.id, [{ type: 'text', text: 'Edited' }])
    expect(coordinator.get(task.id).pendingFirstTurn).toEqual({
      delivery: 'pending', payload: { input: [{ type: 'text', text: 'Edited' }] },
    })
    await coordinator.bindThread(task.id, 'missing-thread')
    await coordinator.markPendingTurnSending(task.id)
    await coordinator.resetMissingPendingThread(task.id)
    expect(coordinator.get(task.id)).toMatchObject({
      threadId: null, pendingFirstTurn: { delivery: 'pending' },
    })
    await coordinator.acknowledgePendingTurn(task.id)
    expect(coordinator.get(task.id).pendingFirstTurn).toBeNull()
  })

  it('moves an ordinary Local session into a newly provisioned worktree', async () => {
    const { store } = fixture()
    const worktree = {
      id: 'worktree', projectId: 'project', taskId: 'task', checkoutId: 'managed',
      path: '/managed/task', recordedRoot: '/managed', gitCommonDir: '/repo/.git',
      manifestPath: '/managed/task/.cranberri/worktree.json', baseRef: 'refs/heads/main',
      baseSha: 'a'.repeat(40), branch: null, headSha: 'a'.repeat(40), archiveHeadSha: null,
      privateRef: null, lifecycle: 'active' as const, cleanupReason: null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }
    const lifecycle = { create: async () => worktree } as unknown as WorktreeLifecycle
    const coordinator = new TaskCoordinator(store, lifecycle)
    const local = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [{ type: 'text', text: 'Local' }],
    })
    await coordinator.bindThread(local.id, 'thread')

    const continued = await coordinator.continueInWorktree(local.id, {
      projectName: 'Project', localCheckoutId: 'local', localCheckoutPath: '/repo',
      managedRoot: '/managed', cap: 15, baseRef: 'refs/heads/main',
      environmentId: null, environmentRevision: null, includeLocalChanges: false,
    })

    expect(continued).toMatchObject({
      location: 'worktree', state: 'provisioning', worktreeId: 'worktree', checkoutId: 'managed',
      threadId: 'thread',
      worktreeTransition: { phase: 'resuming', previousCheckoutId: 'local' },
    })
    expect(await coordinator.completeWorktreeTransition(local.id)).toMatchObject({
      location: 'worktree', state: 'active', worktreeTransition: null,
    })
  })

  it('rolls a failed runtime move back to the original Local binding', async () => {
    const { store } = fixture()
    const worktree = {
      id: 'worktree', projectId: 'project', taskId: 'task', checkoutId: 'managed',
      path: '/managed/task', recordedRoot: '/managed', gitCommonDir: '/repo/.git',
      manifestPath: '/managed/task/.cranberri/worktree.json', baseRef: 'refs/heads/main',
      baseSha: 'a'.repeat(40), branch: null, headSha: 'a'.repeat(40), archiveHeadSha: null,
      privateRef: null, lifecycle: 'active' as const, cleanupReason: null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }
    const remove = vi.fn(async () => ({ ...worktree, lifecycle: 'removed' as const }))
    const lifecycle = { create: async () => worktree, remove } as unknown as WorktreeLifecycle
    const coordinator = new TaskCoordinator(store, lifecycle)
    const local = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [{ type: 'text', text: 'Local' }],
    })
    await coordinator.bindThread(local.id, 'thread')
    await coordinator.continueInWorktree(local.id, {
      projectName: 'Project', localCheckoutId: 'local', localCheckoutPath: '/repo',
      managedRoot: '/managed', cap: 15, baseRef: 'refs/heads/main',
      environmentId: null, environmentRevision: null, includeLocalChanges: false,
    })

    const rolledBack = await coordinator.rollbackWorktreeTransition(local.id)

    expect(remove).toHaveBeenCalledWith('worktree')
    expect(rolledBack).toMatchObject({
      checkoutId: 'local', worktreeId: null, location: 'local', state: 'local',
      baseRef: 'refs/heads/main', worktreeTransition: null,
    })
  })

  it('deletes a Local task and its Codex thread together', async () => {
    const { root, store } = fixture()
    const archiveThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const coordinator = new TaskCoordinator(store, undefined, {
      codex: {
        inspectThreadLifecycle: async (threadId) => ({ threadId, state: 'active', cwd: '/repo' }),
        archiveThread, unarchiveThread: async () => ({}), deleteThread,
      },
      activity: { assertIdle: async () => undefined },
      snapshots: new WorktreeSnapshotStore(path.join(root, 'snapshots')),
      repositoryPath: () => '/repo',
      restoreEnvironment: async () => undefined,
    })
    const task = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    })

    await coordinator.archive(task.id)
    await coordinator.delete(task.id)

    expect(archiveThread).toHaveBeenCalledWith('thread')
    expect(deleteThread).toHaveBeenCalledWith('thread')
    expect(store.read().tasks).toEqual([])
  })

  it('keeps an active task untouched when Codex archive is not observed', async () => {
    const { root, store } = fixture()
    const archiveThread = vi.fn(async () => {
      const state = store.read()
      expect(state.tasks[0]?.state).toBe('local')
      expect(state.lifecycleOperations[0]).toMatchObject({
        kind: 'archive', phase: 'threadArchiveRequested', rpc: { status: 'requested' },
      })
      throw new Error('connection lost')
    })
    const coordinator = new TaskCoordinator(store, undefined, {
      codex: {
        inspectThreadLifecycle: async (threadId) => ({ threadId, state: 'active', cwd: '/repo' }),
        archiveThread, unarchiveThread: async () => ({}), deleteThread: async () => undefined,
      },
      activity: { assertIdle: async () => undefined },
      snapshots: new WorktreeSnapshotStore(path.join(root, 'snapshots')),
      repositoryPath: () => '/repo',
      restoreEnvironment: async () => undefined,
    })
    const task = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    })

    await expect(coordinator.archive(task.id)).rejects.toThrow('connection lost')

    expect(coordinator.get(task.id)).toMatchObject({ state: 'local', archivedAt: null })
    expect(store.read().lifecycleOperations[0]).toMatchObject({
      status: 'needsAttention', phase: 'needsAttention', rpc: { status: 'unknown' },
      lastError: { code: 'CODEX_RPC_UNKNOWN' },
    })
  })

  it('archives the conversation but preserves the source when snapshot cleanup is blocked', async () => {
    const { root, store } = fixture()
    const local = await new TaskCoordinator(store).createLocalTask({
      projectId: 'project', title: 'Managed', localCheckoutId: 'managed-checkout',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    })
    await store.update((state) => ({
      ...state,
      tasks: state.tasks.map((task) => ({
        ...task, location: 'worktree' as const, state: 'active' as const, worktreeId: 'worktree',
      })),
      managedWorktrees: [{
        id: 'worktree', projectId: 'project', checkoutId: 'managed-checkout', taskId: local.id,
        path: '/managed/task', recordedRoot: '/managed', gitCommonDir: '/repo/.git',
        manifestPath: '/managed/.cranberri/manifests/worktree.json', baseRef: 'refs/heads/main',
        baseSha: 'a'.repeat(40), branch: null, headSha: 'a'.repeat(40), archiveHeadSha: null,
        privateRef: null, snapshot: null, lifecycle: 'active', cleanupReason: null,
        createdAt: 1, updatedAt: 1, archivedAt: null,
      }],
    }))
    const prepared = {
      snapshot: {
        version: 1 as const,
        artifactId: 'artifact-retry',
        taskId: local.id,
        worktreeId: 'worktree',
        artifactPath: path.join(root, 'snapshots', 'artifact-retry'),
        artifactBytes: 12,
        artifactDigestSha256: 'b'.repeat(64),
        headSha: 'a'.repeat(40),
        bundleIncluded: false,
      },
      headSha: 'a'.repeat(40),
      privateRef: `refs/cranberri/tasks/${local.id}`,
      sourceGuard: 'source-guard',
    }
    const prepareArchive = vi.fn()
      .mockRejectedValueOnce(new Error('unsupported symlink'))
      .mockResolvedValueOnce(prepared)
    const removePreparedArchive = vi.fn(async () => ({
      headSha: prepared.headSha,
      privateRef: prepared.privateRef,
      quarantinePath: '/managed/.cranberri/quarantine/archive',
    }))
    const purgeArchiveQuarantine = vi.fn(async () => undefined)
    const lifecycle = { prepareArchive, removePreparedArchive, purgeArchiveQuarantine } as unknown as WorktreeLifecycle
    const archiveThread = vi.fn(async () => undefined)
    const coordinator = new TaskCoordinator(store, lifecycle, {
      codex: {
        inspectThreadLifecycle: async (threadId) => ({ threadId, state: 'active', cwd: '/repo' }),
        archiveThread, unarchiveThread: async () => ({}), deleteThread: async () => undefined,
      },
      activity: { assertIdle: async () => undefined },
      snapshots: new WorktreeSnapshotStore(path.join(root, 'snapshots')),
      repositoryPath: () => '/repo',
      restoreEnvironment: async () => undefined,
    })

    const result = await coordinator.archive(local.id)

    expect(archiveThread).toHaveBeenCalledWith('thread')
    expect(removePreparedArchive).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      task: { state: 'cleanupBlocked', archivedAt: expect.any(Number) },
      warning: { kind: 'cleanupBlocked', message: 'unsupported symlink' },
    })
    expect(store.read().managedWorktrees[0]).toMatchObject({
      lifecycle: 'cleanupBlocked', path: '/managed/task', snapshot: null,
    })

    const retried = await coordinator.archive(local.id)

    expect(archiveThread).toHaveBeenCalledTimes(1)
    expect(removePreparedArchive).toHaveBeenCalledTimes(1)
    expect(purgeArchiveQuarantine).toHaveBeenCalledTimes(1)
    expect(retried).toMatchObject({ task: { state: 'archived' }, warning: null })
    expect(store.read().managedWorktrees[0]).toMatchObject({
      lifecycle: 'removed', cleanupReason: null, snapshot: prepared.snapshot,
    })
  })

  it('requires archive before permanent deletion', async () => {
    const { coordinator } = fixture()
    const task = await coordinator.createLocalTask({
      projectId: 'project', title: 'Local', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    })

    await expect(coordinator.delete(task.id)).rejects.toThrow(/archive.*before deleting/i)
  })

  it('retains the Local lease until a handed-off task returns to its worktree', async () => {
    const { store, coordinator } = fixture()
    const task = await coordinator.createLocalTask({
      projectId: 'project', title: 'Handoff', localCheckoutId: 'local',
      baseRef: 'refs/heads/main', input: [], threadId: 'thread',
    })
    await store.update((state) => ({
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? { ...candidate, worktreeId: 'worktree' }
        : candidate),
      localLeaseByProjectId: { ...state.localLeaseByProjectId, project: task.id },
    }))
    const before = store.read()
    const deleteThread = vi.fn(async () => undefined)

    await expect(coordinator.archive(task.id)).rejects.toThrow(/return.*worktree/i)
    await expect(coordinator.delete(task.id)).rejects.toThrow(/return.*worktree/i)

    expect(store.read()).toEqual(before)
    expect(deleteThread).not.toHaveBeenCalled()
  })
})
