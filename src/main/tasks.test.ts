import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectRegistry } from '../shared/projects'
import { TaskStore } from './task-store'
import { TaskCoordinator } from './tasks'

const roots: string[] = []

function fixture(): { store: TaskStore; coordinator: TaskCoordinator } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-'))
  roots.push(root)
  const store = new TaskStore(path.join(root, 'tasks.json'))
  return { store, coordinator: new TaskCoordinator(store) }
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
  it('creates one durable Local control task per project', async () => {
    const { store, coordinator } = fixture()
    await coordinator.ensureControlTasks(registry, 10)
    await coordinator.ensureControlTasks(registry, 20)

    expect(store.read().tasks).toEqual([
      expect.objectContaining({
        id: 'control-project', role: 'control', location: 'local',
        state: 'local', baseRef: 'refs/heads/main', createdAt: 10,
      }),
    ])
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

  it('resolves cwd from authoritative checkout and worktree records', async () => {
    const { store, coordinator } = fixture()
    await coordinator.ensureControlTasks(registry)
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

    expect(coordinator.resolveRuntime('control-project', registry).cwd).toBe('/repo')
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
    await coordinator.acknowledgePendingTurn(task.id)
    expect(coordinator.get(task.id).pendingFirstTurn).toBeNull()
  })
})
