import type { Task } from '@/shared/tasks'

export function taskUpdateBlockers(
  tasks: ReadonlyArray<Task>,
  environmentRunning: (taskId: string) => boolean,
  codexBlockers: ReadonlyArray<string>,
): string[] {
  const blockers = [...codexBlockers]
  for (const task of tasks) {
    if (task.handoff || task.state === 'handingOff') blockers.push(`Task ${task.id} is handing off between checkouts`)
    if (task.worktreeTransition) blockers.push(`Task ${task.id} is changing worktree state`)
    if (environmentRunning(task.id)) blockers.push(`Environment setup is running for task ${task.id}`)
  }
  return [...new Set(blockers)]
}
