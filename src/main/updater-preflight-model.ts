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

export type UpdateSignatureStatus = 'developerId' | 'adHoc' | 'other' | 'unsigned'

export function signatureStatusFromCodesign(output: string | null): UpdateSignatureStatus {
  if (!output) return 'unsigned'
  if (/not signed at all|code object is not signed/i.test(output)) return 'unsigned'
  if (/Authority=Developer ID Application:/i.test(output)) return 'developerId'
  if (/Signature=adhoc/i.test(output)) return 'adHoc'
  return 'other'
}

export function releaseProvenanceError(values: {
  releaseTag: string
  releaseCommit: string
  manifestTag: string
  manifestCommit: string
  manifestChannel: 'stable' | 'beta'
}): string | null {
  if (values.manifestChannel !== 'stable') return 'Stable releases require a stable-channel integrity manifest'
  if (values.manifestTag !== values.releaseTag) return 'Release tag does not match its integrity manifest'
  if (values.manifestCommit !== values.releaseCommit) return 'Release commit does not match its integrity manifest'
  return null
}
