import os from 'node:os'
import path from 'node:path'
import { EnvironmentRunner } from './environments/runner'
import { EnvironmentStore } from './environments/store'
import { TaskStore } from './task-store'
import { TaskCoordinator } from './tasks'
import { WorktreeLifecycle } from './worktree-lifecycle'
import { WorktreeSnapshotStore } from './worktree-snapshot-store'
import {
  authoritativeThreadCheck,
  configureStartupRecoveryRuntime,
  recordStartupTaskStoreFailure,
  reconcileStartup,
  type ThreadCheck,
} from './startup-recovery'
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
export const worktreeSnapshotStore = new WorktreeSnapshotStore(path.join(os.homedir(), '.cranberri', 'worktree-snapshots'))
export const taskCoordinator = new TaskCoordinator(taskStore, worktreeLifecycle, {
  snapshots: worktreeSnapshotStore,
  codex: {
    inspectThreadLifecycle: async (threadId) => {
      const client = await (await import('./codex/ipc')).getCodexClient()
      return client.inspectThreadLifecycle(threadId)
    },
    archiveThread: async (threadId) => {
      const client = await (await import('./codex/ipc')).getCodexClient()
      return client.archiveThread(threadId)
    },
    unarchiveThread: async (threadId) => {
      const client = await (await import('./codex/ipc')).getCodexClient()
      return client.unarchiveThread(threadId)
    },
    deleteThread: async (threadId) => {
      const client = await (await import('./codex/ipc')).getCodexClient()
      return client.deleteThread(threadId)
    },
  },
  activity: {
    assertIdle: async (task) => {
      const environmentJob = environmentRunner.latestForTask(task.id)
      if (environmentJob?.status === 'running') {
        throw new Error('Wait for environment setup to finish before changing this session')
      }
      if (!task.threadId) return
      const client = await (await import('./codex/ipc')).getCodexClient()
      if (client.isThreadRunning(task.threadId) || client.hasActiveWorkers(task.threadId)) {
        throw new Error('Wait for Codex and its workers to finish before changing this session')
      }
    },
  },
  repositoryPath: (projectId) => {
    const registry = readProjectRegistry()
    const project = registry.projects.find((candidate) => candidate.id === projectId)
    const checkout = project
      ? registry.checkouts.find((candidate) => candidate.id === project.localCheckoutId && candidate.available)
      : null
    if (!checkout) throw new Error('Project Local checkout is unavailable')
    return checkout.canonicalPath
  },
  restoreEnvironment: async (task, _worktree, revision) => {
    const job = await environmentRunner.startSetup({ taskId: task.id })
    const result = await environmentRunner.wait(job.id)
    if (result.status !== 'succeeded') throw new Error(`Environment setup ${result.status} for revision ${revision}`)
  },
})

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
  return reconcileStartup()
}
