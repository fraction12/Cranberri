import fs from 'node:fs'
import type { Task } from '../shared/tasks'
import type { TaskStore } from './task-store'

function recoverTask(task: Task, interruptedTaskIds: ReadonlySet<string>, now: number): Task {
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
    const tasks = state.tasks
      .filter((task) => task.role !== 'control' || Boolean(task.threadId))
      .map((task) => recoverTask(task.role === 'control' ? { ...task, role: 'root' as const } : task, interruptedTaskIds, now))
    const tasksById = new Map(tasks.map((task) => [task.id, task]))
    const localLeaseByProjectId = Object.fromEntries(Object.entries(state.localLeaseByProjectId).map(([projectId, taskId]) => {
      const task = taskId ? tasksById.get(taskId) : null
      return [projectId, task?.location === 'local' && task.state === 'local' ? taskId : null]
    }))
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
