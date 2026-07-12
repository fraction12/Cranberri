export interface TaskHandoffProposal {
  branch: string
  createBranch: boolean
}

export function taskHandoffProposal({
  taskId,
  location,
  activeBranch,
  recordedWorktreeBranch,
}: {
  taskId: string
  location: 'local' | 'worktree'
  activeBranch: string | null
  recordedWorktreeBranch: string | null
}): TaskHandoffProposal {
  if (location === 'local') {
    return {
      branch: recordedWorktreeBranch ?? activeBranch ?? `codex/task-${taskId.slice(0, 8)}`,
      createBranch: false,
    }
  }
  if (activeBranch && activeBranch !== 'HEAD') return { branch: activeBranch, createBranch: false }
  return { branch: `codex/task-${taskId.slice(0, 8)}`, createBranch: true }
}
