import { describe, expect, it } from 'vitest'
import type { Checkout, Project } from '@/shared/projects'
import type { Task } from '@/shared/tasks'
import { bindWindowExecutionContext, resolveTaskExecutionContext } from './execution-context'

const project: Project = {
  id: 'project-1',
  name: 'Cranberri',
  gitCommonDir: '/repo/.git',
  localCheckoutId: 'checkout-local',
  pinnedLocalBranch: 'main',
  defaultEnvironmentId: null,
  controlTaskId: 'task-control',
  localLeaseTaskId: null,
}

const checkout: Checkout = {
  id: 'checkout-worktree',
  projectId: project.id,
  kind: 'managed',
  canonicalPath: '/worktrees/task-1',
  gitCommonDir: project.gitCommonDir,
  ownership: 'cranberri',
  available: true,
}

const localCheckout: Checkout = {
  id: project.localCheckoutId,
  projectId: project.id,
  kind: 'local',
  canonicalPath: '/repo',
  gitCommonDir: project.gitCommonDir,
  ownership: 'user',
  available: true,
}

const task: Task = {
  id: 'task-1',
  projectId: project.id,
  threadId: 'thread-1',
  checkoutId: checkout.id,
  worktreeId: 'worktree-1',
  role: 'root',
  location: 'worktree',
  state: 'active',
  baseRef: 'main',
  baseSha: 'abc123',
  environmentId: null,
  environmentRevision: null,
  pendingFirstTurn: null,
  createdAt: 1,
  updatedAt: 2,
}

describe('task execution context', () => {
  it('resolves the canonical checkout path and complete immutable identity', () => {
    expect(resolveTaskExecutionContext(
      { projectId: project.id, taskId: task.id, checkoutId: checkout.id },
      { projects: [project], checkouts: [checkout], tasks: [task] },
    )).toEqual({
      status: 'available',
      context: {
        projectId: project.id,
        taskId: task.id,
        checkoutId: checkout.id,
        worktreeId: task.worktreeId,
        checkoutPath: checkout.canonicalPath,
      },
    })
  })

  it.each([
    ['project-missing', [], [checkout], [task]],
    ['checkout-missing', [project], [], [task]],
    ['task-missing', [project], [checkout], []],
  ] as const)('returns an explicit %s state', (reason, projects, checkouts, tasks) => {
    expect(resolveTaskExecutionContext(
      { projectId: project.id, taskId: task.id, checkoutId: checkout.id },
      { projects: [...projects], checkouts: [...checkouts], tasks: [...tasks] },
    )).toMatchObject({ status: 'unavailable', reason })
  })

  it('rejects a task binding that points at another checkout', () => {
    expect(resolveTaskExecutionContext(
      { projectId: project.id, taskId: task.id, checkoutId: 'checkout-local' },
      { projects: [project], checkouts: [checkout], tasks: [task] },
    )).toMatchObject({ status: 'unavailable', reason: 'task-mismatch' })
  })

  it('falls back to Local when a deleted task was bound to the Local checkout', () => {
    expect(resolveTaskExecutionContext(
      { projectId: project.id, taskId: 'deleted-control-task', checkoutId: localCheckout.id },
      { projects: [project], checkouts: [localCheckout], tasks: [] },
    )).toEqual({
      status: 'available',
      context: {
        projectId: project.id,
        taskId: null,
        checkoutId: localCheckout.id,
        worktreeId: null,
        checkoutPath: localCheckout.canonicalPath,
      },
    })
  })

  it('binds identity at creation without retaining a mutable context object', () => {
    const context = {
      projectId: project.id,
      taskId: task.id,
      checkoutId: checkout.id,
      worktreeId: task.worktreeId,
      checkoutPath: checkout.canonicalPath,
    }
    const window = bindWindowExecutionContext({ id: 'terminal', type: 'terminal', title: 'Terminal' }, context)
    context.checkoutId = 'later-checkout'
    expect(window.checkoutId).toBe(checkout.id)
  })
})
