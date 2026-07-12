import { describe, expect, it } from 'vitest'
import type { Task } from '@/shared/tasks'
import { taskHeaderDetail } from './TaskHeader'

function task(location: Task['location'], baseRef: string | null = 'refs/heads/main'): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    checkoutId: 'checkout-1',
    worktreeId: location === 'worktree' ? 'worktree-1' : null,
    role: 'root',
    location,
    state: location === 'worktree' ? 'active' : 'local',
    baseRef,
    baseSha: 'a'.repeat(40),
    environmentId: null,
    environmentRevision: null,
    pendingFirstTurn: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('taskHeaderDetail', () => {
  it('describes a detached worktree by its base instead of presenting the base as its branch', () => {
    expect(taskHeaderDetail(task('worktree'), null)).toBe('from main')
  })

  it('shows the live branch once the worktree checks one out', () => {
    expect(taskHeaderDetail(task('worktree'), 'feature/native-chat')).toBe('feature/native-chat')
  })

  it('keeps the current branch label for local sessions', () => {
    expect(taskHeaderDetail(task('local'), 'main')).toBe('main')
  })
})
