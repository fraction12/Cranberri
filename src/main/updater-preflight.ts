import { activeCodexTaskBlockers } from './codex/ipc'
import { hasRunningProcessesForPath } from './processRegistry'
import { readProjectRegistry } from './repos'
import { environmentRunner, taskStore } from './worktree-runtime'
import { taskUpdateBlockers } from './updater-preflight-model'

export async function assertUpdateQuiescent(): Promise<void> {
  const state = taskStore.read()
  const blockers = taskUpdateBlockers(
    state.tasks,
    (taskId) => environmentRunner.latestForTask(taskId)?.status === 'running',
    activeCodexTaskBlockers(state.tasks),
  )
  const registry = readProjectRegistry()
  const paths = new Set([
    ...registry.checkouts.filter((checkout) => checkout.available).map((checkout) => checkout.canonicalPath),
    ...state.managedWorktrees.filter((worktree) => worktree.lifecycle !== 'removed').map((worktree) => worktree.path),
  ])
  for (const checkoutPath of paths) {
    if (await hasRunningProcessesForPath(checkoutPath)) blockers.push(`A terminal or process is still running in ${checkoutPath}`)
  }
  if (blockers.length > 0) {
    throw new Error(`Finish active work before installing: ${blockers.join('; ')}`)
  }
}
