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
import type { CodexThreadLifecycleGateway } from './codex/thread-lifecycle'
import { inspectLegacyArchive } from './task-recovery'

export const taskStore = new TaskStore()
export const worktreeLifecycle = new WorktreeLifecycle(taskStore)
export const environmentStore = new EnvironmentStore()
export const environmentRunner = new EnvironmentRunner({
  taskStore,
  worktrees: worktreeLifecycle,
  environmentStore,
})
export const worktreeSnapshotStore = new WorktreeSnapshotStore(path.join(os.homedir(), '.cranberri', 'worktree-snapshots'))
export const codexThreadLifecycleGateway: CodexThreadLifecycleGateway = {
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
}

function repositoryPath(projectId: string): string {
  const registry = readProjectRegistry()
  const project = registry.projects.find((candidate) => candidate.id === projectId)
  const checkout = project
    ? registry.checkouts.find((candidate) => candidate.id === project.localCheckoutId && candidate.available)
    : null
  if (!checkout) throw new Error('Project Local checkout is unavailable')
  return checkout.canonicalPath
}

async function restoreEnvironment(taskId: string, revision: string): Promise<void> {
  const job = await environmentRunner.startSetup({ taskId })
  const result = await environmentRunner.wait(job.id)
  if (result.status !== 'succeeded') throw new Error(`Environment setup ${result.status} for revision ${revision}`)
}

export const taskCoordinator = new TaskCoordinator(taskStore, worktreeLifecycle, {
  snapshots: worktreeSnapshotStore,
  codex: codexThreadLifecycleGateway,
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
  repositoryPath,
  restoreEnvironment: async (task, _worktree, revision) => restoreEnvironment(task.id, revision),
  inspectLegacyArchive,
})

export async function checkStartupThread(threadId: string): Promise<ThreadCheck> {
  return authoritativeThreadCheck(
    codexThreadLifecycleGateway.inspectThreadLifecycle,
    threadId,
  )
}

export async function settleStartupMaintenance(
  report: StartupRecoveryReport,
  maintenance: () => Promise<unknown>,
): Promise<StartupRecoveryReport> {
  try {
    await maintenance()
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
    taskRecovery: {
      codex: codexThreadLifecycleGateway,
      worktrees: worktreeLifecycle,
      snapshotStore: worktreeSnapshotStore,
      repositoryPath,
      restoreEnvironment: async (task, _worktree, revision) => restoreEnvironment(task.id, revision),
    },
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
