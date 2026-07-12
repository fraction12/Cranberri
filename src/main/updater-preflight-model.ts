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

export function supportsMinimumSystemVersion(currentVersion: string, minimumVersion: string | null): boolean {
  if (!minimumVersion) return true
  const current = currentVersion.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const minimum = minimumVersion.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(current.length, minimum.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (current[index] ?? 0) - (minimum[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}
