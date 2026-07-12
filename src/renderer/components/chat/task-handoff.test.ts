import { describe, expect, it } from 'vitest'
import { taskHandoffProposal } from './task-handoff'

describe('task handoff proposal', () => {
  it('creates a task branch when the managed worktree is detached', () => {
    expect(taskHandoffProposal({
      taskId: '12345678-abcd',
      location: 'worktree',
      activeBranch: null,
      recordedWorktreeBranch: null,
    })).toEqual({ branch: 'codex/task-12345678', createBranch: true })
  })

  it('reuses a branch created by the agent in the worktree', () => {
    expect(taskHandoffProposal({
      taskId: 'task-1',
      location: 'worktree',
      activeBranch: 'feature/worktrees',
      recordedWorktreeBranch: null,
    })).toEqual({ branch: 'feature/worktrees', createBranch: false })
  })

  it('returns a local handoff to the branch recorded on its managed worktree', () => {
    expect(taskHandoffProposal({
      taskId: 'task-1',
      location: 'local',
      activeBranch: 'feature/local-test',
      recordedWorktreeBranch: 'feature/worktree-owner',
    })).toEqual({ branch: 'feature/worktree-owner', createBranch: false })
  })
})
