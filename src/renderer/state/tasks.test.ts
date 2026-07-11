import { describe, expect, it } from 'vitest'
import type { Checkout } from '@/shared/projects'
import type { Task } from '@/shared/tasks'
import { selectableRootTasks, taskExecutionContext } from './tasks'

function task(id: string, role: Task['role'], updatedAt: number): Task {
  return {
    id,
    projectId: 'project-1',
    threadId: `thread-${id}`,
    checkoutId: `checkout-${id}`,
    worktreeId: `worktree-${id}`,
    role,
    location: 'worktree',
    state: 'active',
    baseRef: 'main',
    baseSha: 'abc',
    environmentId: null,
    environmentRevision: null,
    pendingFirstTurn: null,
    createdAt: updatedAt - 1,
    updatedAt,
  }
}

describe('task selectors', () => {
  it('returns control and root tasks newest-first while excluding workers', () => {
    const tasks = [task('old', 'root', 10), task('worker', 'worker', 30), task('new', 'root', 20)]
    expect(selectableRootTasks(tasks).map((candidate) => candidate.id)).toEqual(['new', 'old'])
  })

  it('does not resolve an unavailable checkout', () => {
    const root = task('root', 'root', 10)
    const checkout: Checkout = {
      id: root.checkoutId,
      projectId: root.projectId,
      kind: 'managed',
      canonicalPath: '/worktree/root',
      gitCommonDir: '/repo/.git',
      ownership: 'cranberri',
      available: false,
    }
    expect(taskExecutionContext(root, [checkout])).toBeNull()
  })
})
