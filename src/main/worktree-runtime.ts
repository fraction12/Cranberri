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
  reconcileStartup,
  type ThreadCheck,
} from './startup-recovery'
import { readSettings } from './settings'
import { HandoffCoordinator } from './handoff'
import { readProjectRegistry } from './repos'

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

export const recoverStartupRuntime = async () => {
  configureStartupRecoveryRuntime({
    taskStore,
    checkThread: checkStartupThread,
    recoverHandoff: async (taskId) => {
      const coordinator = new HandoffCoordinator(taskStore, readProjectRegistry(), {
        isThreadRunning: () => false,
        hasActiveWorkers: () => false,
        resumeThread: async () => undefined,
      }, path.join(os.homedir(), '.cranberri', 'handoff-bundles'))
      await coordinator.recoverInterrupted(taskId)
    },
  })
  const report = await reconcileStartup()
  await worktreeLifecycle.sweepRetention({ retentionDays: readSettings().worktrees.retentionDays })
  return report
}
