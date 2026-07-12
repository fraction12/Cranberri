import os from 'node:os'
import path from 'node:path'
import { EnvironmentRunner } from './environments/runner'
import { EnvironmentStore } from './environments/store'
import { TaskStore } from './task-store'
import { TaskCoordinator } from './tasks'
import { WorktreeLifecycle } from './worktree-lifecycle'
import {
  authoritativeThreadCheck,
  configureStartupRecoveryRuntime,
  recordStartupTaskStoreFailure,
  reconcileStartup,
  type ThreadCheck,
} from './startup-recovery'
import { readSettings } from './settings'
import { HandoffCoordinator } from './handoff'
import { readProjectRegistry } from './repos'
import type { StartupRecoveryReport } from '../shared/recovery'

export const taskStore = new TaskStore()
export const worktreeLifecycle = new WorktreeLifecycle(taskStore)
export const environmentStore = new EnvironmentStore()
export const environmentRunner = new EnvironmentRunner({
  taskStore,
  worktrees: worktreeLifecycle,
  environmentStore,
})
export const taskCoordinator = new TaskCoordinator(taskStore, worktreeLifecycle)

export async function checkStartupThread(threadId: string): Promise<ThreadCheck> {
  return authoritativeThreadCheck(async (persistedThreadId) => {
    const { getCodexClient } = await import('./codex/ipc')
    const client = await getCodexClient()
    await client.readThread(persistedThreadId)
  }, threadId)
}

export async function settleStartupMaintenance(
  report: StartupRecoveryReport,
  sweep: () => Promise<unknown>,
): Promise<StartupRecoveryReport> {
  try {
    await sweep()
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task maintenance failed during startup'
    console.error('[startup-recovery] task maintenance remains blocked', error)
    return recordStartupTaskStoreFailure(report, message)
  }
}

export const recoverStartupRuntime = async () => {
  configureStartupRecoveryRuntime({
    taskStore,
    checkThread: checkStartupThread,
    recoverHandoff: async (taskId) => {
      const { getCodexClient } = await import('./codex/ipc')
      const client = await getCodexClient()
      const coordinator = new HandoffCoordinator(taskStore, readProjectRegistry(), {
        isThreadRunning: (threadId) => client.isThreadRunning(threadId),
        hasActiveWorkers: (threadId) => client.hasActiveWorkers(threadId),
        resumeThread: (threadId, runtime) => client.resumeThread(threadId, runtime),
      }, path.join(os.homedir(), '.cranberri', 'handoff-bundles'))
      await coordinator.recoverInterrupted(taskId)
    },
  })
  const report = await reconcileStartup()
  return settleStartupMaintenance(report, () => (
    worktreeLifecycle.sweepRetention({ retentionDays: readSettings().worktrees.retentionDays })
  ))
}
