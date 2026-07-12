import fs from 'node:fs'
import type { Task } from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import type { TaskStore } from './task-store'

function recoverTask(task: Task, interruptedTaskIds: ReadonlySet<string>, now: number, transitionWorktree?: ManagedWorktree): Task {
  if (task.worktreeTransition) {
    if (task.location === 'local' && !task.worktreeId) {
      if (transitionWorktree) {
        return {
          ...task,
          checkoutId: transitionWorktree.checkoutId,
          worktreeId: transitionWorktree.id,
          location: 'worktree',
          state: 'needsAttention',
          baseSha: transitionWorktree.baseSha,
          worktreeTransition: {
            ...task.worktreeTransition,
            phase: 'needsAttention',
            error: 'Cranberri restarted after creating the worktree but before binding the session.',
          },
          updatedAt: now,
        }
      }
      return {
        ...task,
        checkoutId: task.worktreeTransition.previousCheckoutId,
        state: 'local',
        baseRef: task.worktreeTransition.previousBaseRef,
        baseSha: task.worktreeTransition.previousBaseSha,
        environmentId: task.worktreeTransition.previousEnvironmentId,
        environmentRevision: task.worktreeTransition.previousEnvironmentRevision,
        worktreeTransition: null,
        updatedAt: now,
      }
    }
    return {
      ...task,
      state: 'needsAttention',
      worktreeTransition: {
        ...task.worktreeTransition,
        phase: 'needsAttention',
        error: task.worktreeTransition.error ?? 'Cranberri restarted while moving this session into a worktree.',
      },
      updatedAt: now,
    }
  }
  if (task.state === 'handingOff' || interruptedTaskIds.has(task.id)) {
    return {
      ...task,
      state: 'needsAttention',
      updatedAt: now,
      handoff: task.handoff ? {
        ...task.handoff,
        phase: 'needsAttention',
        error: task.handoff.error ?? 'Cranberri restarted during handoff. Review the retained transfer bundle before retrying.',
      } : task.handoff,
    }
  }
  if (task.state === 'provisioning') {
    return { ...task, state: 'draft', updatedAt: now }
  }
  if (task.state === 'setup') {
    return { ...task, state: 'failed', updatedAt: now }
  }
  if (task.threadId && task.pendingFirstTurn?.delivery === 'pending') {
    return { ...task, threadId: null, updatedAt: now }
  }
  if (task.pendingFirstTurn?.delivery === 'sending') {
    return {
      ...task,
      state: task.location === 'local' ? 'local' : 'active',
      pendingFirstTurn: { ...task.pendingFirstTurn, delivery: 'pending' },
      updatedAt: now,
    }
  }
  return task
}

export async function reconcileTaskStore(store: TaskStore, now = Date.now()): Promise<void> {
  await store.update((state) => {
    const interruptedTaskIds = new Set(state.interruptedOperations.flatMap((operation) => (
      typeof operation.taskId === 'string' ? [operation.taskId] : []
    )))
    const transitionWorktrees = new Map(state.managedWorktrees
      .filter((worktree) => worktree.taskId && worktree.lifecycle !== 'removed')
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map((worktree) => [worktree.taskId!, worktree]))
    const tasks = state.tasks
      .filter((task) => task.role !== 'control' || Boolean(task.threadId))
      .map((task) => recoverTask(
        task.role === 'control' ? { ...task, role: 'root' as const } : task,
        interruptedTaskIds,
        now,
        transitionWorktrees.get(task.id),
      ))
    const localLeaseByProjectId = Object.fromEntries(
      Object.keys(state.localLeaseByProjectId).map((projectId) => [projectId, null]),
    )
    const managedWorktrees = state.managedWorktrees.map((worktree) => {
      if (worktree.lifecycle === 'removed' || fs.existsSync(worktree.path)) return worktree
      return {
        ...worktree,
        lifecycle: 'needsAttention' as const,
        cleanupReason: 'Managed worktree path was unavailable when Cranberri restarted.',
        updatedAt: now,
      }
    })
    return { ...state, tasks, managedWorktrees, localLeaseByProjectId, interruptedOperations: [] }
  })
}
