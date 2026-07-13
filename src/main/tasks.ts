import type { ProjectRegistry } from '../shared/projects'
import type { CodexRuntimeContext, CodexUserInput } from '../shared/codex'
import type { LifecycleOperation, LifecycleRpcOutcome, PendingFirstTurn, Task, TaskLifecycleResult } from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import type { WorktreeLifecycle } from './worktree-lifecycle'
import { TaskStore } from './task-store'
import type { WorktreeSnapshotStore } from './worktree-snapshot-store'
import type { CodexThreadLifecycleGateway } from './codex/thread-lifecycle'

export interface WorktreeDraftRequest {
  projectId: string
  title: string
  baseRef: string
  environmentId: string | null
  environmentRevision: string | null
  input: PendingFirstTurn['payload']['input']
}

export interface WorktreeProvisioningContext {
  projectName: string
  localCheckoutId: string
  localCheckoutPath: string
  managedRoot: string
  cap: number
}

export interface LocalTaskRequest {
  projectId: string
  title: string
  localCheckoutId: string
  baseRef: string | null
  input: PendingFirstTurn['payload']['input']
  threadId?: string | null
  archived?: boolean
}

export interface ContinueInWorktreeContext extends WorktreeProvisioningContext {
  baseRef: string
  environmentId: string | null
  environmentRevision: string | null
  includeLocalChanges: boolean
}

export type CodexThreadGateway = CodexThreadLifecycleGateway

export interface TaskActivityGate {
  assertIdle(task: Task, worktree: ManagedWorktree | null): Promise<void>
}

export interface TaskLifecycleDependencies {
  codex: CodexThreadGateway
  activity: TaskActivityGate
  snapshots: WorktreeSnapshotStore
  repositoryPath(projectId: string): string
  restoreEnvironment(task: Task, worktree: ManagedWorktree, revision: string): Promise<void>
}

export function assertTaskRunnable(task: Task): void {
  const expectedState = task.location === 'local' ? 'local' : 'active'
  if (task.state !== expectedState) {
    throw new Error(`Session cannot run while its task state is ${task.state}`)
  }
}

export class TaskCoordinator {
  constructor(
    private readonly store = new TaskStore(),
    private readonly worktrees?: WorktreeLifecycle,
    private readonly lifecycle?: TaskLifecycleDependencies,
  ) {}

  async createLocalTask(request: LocalTaskRequest, now = Date.now()): Promise<Task> {
    let selected: Task | undefined
    await this.store.update((state) => {
      const existing = request.threadId
        ? state.tasks.find((task) => task.threadId === request.threadId)
        : null
      if (existing) {
        if (existing.projectId !== request.projectId) {
          throw new Error('Codex thread is already bound to another project')
        }
        selected = existing
        return state
      }
      const task: Task = {
        id: crypto.randomUUID(),
        projectId: request.projectId,
        threadId: request.threadId ?? null,
        checkoutId: request.localCheckoutId,
        worktreeId: null,
        role: 'root',
        location: 'local',
        state: request.archived ? 'archived' : 'local',
        baseRef: request.baseRef,
        baseSha: null,
        environmentId: null,
        environmentRevision: null,
        pendingFirstTurn: request.threadId ? null : {
          payload: { input: request.input },
          delivery: 'pending',
        },
        worktreeTransition: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: request.archived ? now : null,
      }
      selected = task
      return { ...state, tasks: [...state.tasks, task] }
    })
    if (!selected) throw new Error('Local task creation did not persist')
    return selected
  }

  async createWorktreeDraft(request: WorktreeDraftRequest, now = Date.now()): Promise<Task> {
    const task: Task = {
      id: crypto.randomUUID(),
      projectId: request.projectId,
      threadId: null,
      checkoutId: `pending:${request.projectId}`,
      worktreeId: null,
      role: 'root',
      location: 'worktree',
      state: 'draft',
      baseRef: request.baseRef,
      baseSha: null,
      environmentId: request.environmentId,
      environmentRevision: request.environmentRevision,
      pendingFirstTurn: {
        payload: { input: request.input },
        delivery: 'pending',
      },
      createdAt: now,
      updatedAt: now,
    }
    await this.store.update((state) => ({ ...state, tasks: [...state.tasks, task] }))
    return task
  }

  async provisionWorktreeDraft(
    taskId: string,
    context: WorktreeProvisioningContext,
    includeLocalChanges = false,
  ): Promise<Task> {
    if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
    const task = this.requireTask(taskId)
    if (task.state !== 'draft' && task.state !== 'failed') {
      throw new Error('Task is not ready for worktree provisioning')
    }
    if (!task.baseRef) throw new Error('Worktree task has no base ref')

    await this.patchTask(taskId, { state: 'provisioning' })
    try {
      const worktree = await this.worktrees.create({
        projectId: task.projectId,
        projectName: context.projectName,
        taskId: task.id,
        taskName: task.pendingFirstTurn?.payload.input
          .find((item) => item.type === 'text')?.text as string | undefined ?? 'Task',
        localCheckoutPath: context.localCheckoutPath,
        managedRoot: context.managedRoot,
        baseRef: task.baseRef,
        cap: context.cap,
        includeLocalChanges,
      })
      return this.patchTask(taskId, {
        checkoutId: worktree.checkoutId,
        worktreeId: worktree.id,
        baseSha: worktree.baseSha,
        state: task.environmentRevision ? 'setup' : 'active',
      })
    } catch (error) {
      await this.patchTask(taskId, { state: 'failed' })
      throw error
    }
  }

  async continueInWorktree(taskId: string, context: ContinueInWorktreeContext): Promise<Task> {
    if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
    const task = this.requireTask(taskId)
    if (task.role !== 'root' || task.location !== 'local' || task.worktreeId || task.state !== 'local') {
      throw new Error('Only an idle Local session can continue in a worktree')
    }
    await this.patchTask(taskId, {
      state: 'provisioning',
      baseRef: context.baseRef,
      environmentId: context.environmentId,
      environmentRevision: context.environmentRevision,
      worktreeTransition: {
        phase: 'provisioning',
        previousCheckoutId: task.checkoutId,
        previousBaseRef: task.baseRef,
        previousBaseSha: task.baseSha,
        previousEnvironmentId: task.environmentId,
        previousEnvironmentRevision: task.environmentRevision,
        startedAt: Date.now(),
        error: null,
      },
    })
    try {
      const worktree = await this.worktrees.create({
        projectId: task.projectId,
        projectName: context.projectName,
        taskId: task.id,
        taskName: 'continued-session',
        localCheckoutPath: context.localCheckoutPath,
        managedRoot: context.managedRoot,
        baseRef: context.baseRef,
        cap: context.cap,
        includeLocalChanges: context.includeLocalChanges,
      })
      return this.patchTask(taskId, {
        checkoutId: worktree.checkoutId,
        worktreeId: worktree.id,
        location: 'worktree',
        baseSha: worktree.baseSha,
        state: context.environmentRevision ? 'setup' : 'provisioning',
        worktreeTransition: {
          ...this.requireTransition(taskId),
          phase: context.environmentRevision ? 'setup' : 'resuming',
        },
      })
    } catch (error) {
      await this.patchTask(taskId, {
        state: 'local',
        baseRef: task.baseRef,
        baseSha: task.baseSha,
        environmentId: task.environmentId,
        environmentRevision: task.environmentRevision,
        worktreeTransition: null,
      })
      throw error
    }
  }

  async markWorktreeTransitionResuming(taskId: string): Promise<Task> {
    const transition = this.requireTransition(taskId)
    return this.patchTask(taskId, {
      state: 'provisioning',
      worktreeTransition: { ...transition, phase: 'resuming', error: null },
    })
  }

  async completeWorktreeTransition(taskId: string, state: 'active' | 'failed' = 'active'): Promise<Task> {
    this.requireTransition(taskId)
    await this.store.update((store) => ({
      ...store,
      tasks: store.tasks.map((task) => task.id === taskId ? {
        ...task,
        state,
        worktreeTransition: null,
        updatedAt: Date.now(),
      } : task),
      managedWorktrees: store.managedWorktrees.map((worktree) => worktree.taskId === taskId ? {
        ...worktree,
        lifecycle: state,
        updatedAt: Date.now(),
      } : worktree),
    }))
    return this.requireTask(taskId)
  }

  async failWorktreeTransition(taskId: string, error: unknown): Promise<Task> {
    const message = error instanceof Error ? error.message : 'Worktree transition failed'
    const transition = this.requireTransition(taskId)
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((task) => task.id === taskId ? {
        ...task,
        state: 'needsAttention' as const,
        worktreeTransition: { ...transition, phase: 'needsAttention' as const, error: message },
        updatedAt: Date.now(),
      } : task),
      managedWorktrees: state.managedWorktrees.map((worktree) => worktree.taskId === taskId ? {
        ...worktree,
        lifecycle: 'needsAttention' as const,
        cleanupReason: message,
        updatedAt: Date.now(),
      } : worktree),
    }))
    return this.requireTask(taskId)
  }

  async rollbackWorktreeTransition(taskId: string): Promise<Task> {
    if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
    const task = this.requireTask(taskId)
    const transition = this.requireTransition(taskId)
    try {
      if (task.worktreeId) await this.worktrees.remove(task.worktreeId)
    } catch (error) {
      await this.failWorktreeTransition(taskId, error)
      throw new Error('Could not safely restore the Local session after worktree transition failed', { cause: error })
    }
    return this.patchTask(taskId, {
      checkoutId: transition.previousCheckoutId,
      worktreeId: null,
      location: 'local',
      state: 'local',
      baseRef: transition.previousBaseRef,
      baseSha: transition.previousBaseSha,
      environmentId: transition.previousEnvironmentId,
      environmentRevision: transition.previousEnvironmentRevision,
      worktreeTransition: null,
    })
  }

  async acquireLocalLease(projectId: string, taskId: string): Promise<void> {
    await this.store.update((state) => {
      const holder = state.localLeaseByProjectId[projectId]
      if (holder && holder !== taskId) throw new Error('Local is in use by another task')
      return {
        ...state,
        localLeaseByProjectId: { ...state.localLeaseByProjectId, [projectId]: taskId },
      }
    })
  }

  async releaseLocalLease(projectId: string, taskId: string): Promise<void> {
    await this.store.update((state) => {
      if (state.localLeaseByProjectId[projectId] !== taskId) return state
      return {
        ...state,
        localLeaseByProjectId: { ...state.localLeaseByProjectId, [projectId]: null },
      }
    })
  }

  list(projectId?: string): Task[] {
    return this.store.read().tasks.filter((task) => !projectId || task.projectId === projectId)
  }

  get(taskId: string): Task {
    return this.requireTask(taskId)
  }

  findByThread(threadId: string): Task | null {
    return this.store.read().tasks.find((task) => task.threadId === threadId) ?? null
  }

  resolveRuntime(taskId: string, registry: ProjectRegistry): CodexRuntimeContext {
    const task = this.requireTask(taskId)
    const checkout = registry.checkouts.find((candidate) => candidate.id === task.checkoutId)
    const worktree = task.worktreeId
      ? this.store.read().managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
      : null
    const cwd = worktree?.path ?? checkout?.canonicalPath
    if (!cwd || checkout?.available === false) throw new Error('Task checkout is unavailable')
    if (checkout && checkout.projectId !== task.projectId) throw new Error('Task checkout ownership mismatch')
    if (worktree && worktree.projectId !== task.projectId) throw new Error('Task worktree ownership mismatch')
    return { cwd, taskId: task.id, runtimeRoots: this.projectRoots(task.projectId, registry) }
  }

  projectRoots(projectId: string, registry: ProjectRegistry): string[] {
    const checkoutRoots = registry.checkouts
      .filter((checkout) => checkout.projectId === projectId && checkout.available)
      .map((checkout) => checkout.canonicalPath)
    const worktreeRoots = this.store.read().managedWorktrees
      .filter((worktree) => worktree.projectId === projectId && worktree.lifecycle !== 'removed')
      .map((worktree) => worktree.path)
    return [...new Set([...checkoutRoots, ...worktreeRoots])]
  }

  async bindThread(taskId: string, threadId: string): Promise<Task> {
    return this.patchTask(taskId, { threadId })
  }

  async markPendingTurnSending(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId)
    if (!task.pendingFirstTurn || task.pendingFirstTurn.delivery === 'acknowledged') return task
    return this.patchTask(taskId, {
      pendingFirstTurn: { ...task.pendingFirstTurn, delivery: 'sending' },
    })
  }

  async replacePendingTurn(taskId: string, input: Array<Record<string, unknown>>): Promise<Task> {
    const task = this.requireTask(taskId)
    if (!task.pendingFirstTurn) throw new Error('Task has no pending first turn')
    return this.patchTask(taskId, {
      pendingFirstTurn: {
        payload: { ...task.pendingFirstTurn.payload, input },
        delivery: 'pending',
      },
    })
  }

  async resetMissingPendingThread(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId)
    if (!task.pendingFirstTurn) throw new Error('Task has no pending first turn')
    return this.patchTask(taskId, {
      threadId: null,
      pendingFirstTurn: { ...task.pendingFirstTurn, delivery: 'pending' },
    })
  }

  async acknowledgePendingTurn(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId)
    if (!task.pendingFirstTurn) return task
    return this.patchTask(taskId, { pendingFirstTurn: null })
  }

  async restorePendingTurn(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId)
    if (!task.pendingFirstTurn || task.pendingFirstTurn.delivery === 'pending') return task
    return this.patchTask(taskId, {
      pendingFirstTurn: { ...task.pendingFirstTurn, delivery: 'pending' },
    })
  }

  pendingInput(taskId: string): CodexUserInput[] | null {
    const pending = this.requireTask(taskId).pendingFirstTurn
    return pending ? pending.payload.input as CodexUserInput[] : null
  }

  async archive(taskId: string): Promise<TaskLifecycleResult> {
    const task = this.requireTask(taskId)
    this.assertHandoffComplete(task)
    if (task.state === 'cleanupBlocked' && task.archivedAt) return this.retryArchiveCleanup(task)
    if (task.state === 'archived' && task.archivedAt) return { task, warning: null }
    const lifecycle = this.requireLifecycle()
    const worktree = this.worktreeForTask(task)
    await lifecycle.activity.assertIdle(task, worktree)
    const operation = await this.store.beginLifecycleOperation({
      kind: 'archive', taskId: task.id, worktreeId: task.worktreeId, startedAt: Date.now(),
    })
    let prepared: Awaited<ReturnType<WorktreeLifecycle['prepareArchive']>> | null = null
    let cleanupError: unknown = null
    if (worktree) {
      if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
      try {
        prepared = await this.worktrees.prepareArchive({
          operationId: operation.id,
          worktreeId: worktree.id,
          snapshotStore: lifecycle.snapshots,
        })
      } catch (error) {
        cleanupError = error
      }
    }

    if (task.threadId) {
      try {
        await this.runThreadRpc(operation.id, 'archiveThread', task.threadId, () => lifecycle.codex.archiveThread(task.threadId as string))
      } catch (error) {
        if (prepared && worktree) {
          const message = error instanceof Error ? error.message : 'Codex archive outcome is unknown'
          const now = Date.now()
          await this.store.update((state) => ({
            ...state,
            tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
              ...candidate, state: 'needsAttention' as const, lifecycleOperationId: operation.id, updatedAt: now,
            } : candidate),
            managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
              ...candidate, lifecycle: 'needsAttention' as const, cleanupReason: message, updatedAt: now,
            } : candidate),
          }))
        }
        throw error
      }
    }

    if (prepared && worktree && this.worktrees) {
      try {
        await this.worktrees.removePreparedArchive({
          operationId: operation.id,
          worktreeId: worktree.id,
          repositoryPath: lifecycle.repositoryPath(task.projectId),
          snapshotStore: lifecycle.snapshots,
          snapshot: prepared.snapshot,
        })
      } catch (error) {
        cleanupError = error
      }
    }

    const now = Date.now()
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : cleanupError ? 'Worktree cleanup failed' : null
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
        ...candidate,
        state: cleanupMessage ? 'cleanupBlocked' as const : 'archived' as const,
        lifecycleOperationId: operation.id,
        archivedAt: now,
        handoff: null,
        updatedAt: now,
      } : candidate),
      managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree?.id ? {
        ...candidate,
        lifecycle: cleanupMessage ? 'cleanupBlocked' as const : 'removed' as const,
        cleanupReason: cleanupMessage,
        archivedAt: candidate.archivedAt ?? now,
        archiveHeadSha: prepared?.headSha ?? candidate.archiveHeadSha,
        headSha: prepared?.headSha ?? candidate.headSha,
        privateRef: prepared?.privateRef ?? candidate.privateRef,
        snapshot: prepared?.snapshot ?? candidate.snapshot ?? null,
        updatedAt: now,
      } : candidate),
      lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
        ...candidate,
        status: cleanupMessage ? 'needsAttention' as const : 'completed' as const,
        phase: cleanupMessage ? 'needsAttention' as const : 'archived' as const,
        updatedAt: now,
        lastError: cleanupMessage ? { code: 'WORKTREE_CLEANUP_BLOCKED', message: cleanupMessage, recordedAt: now } : null,
      } : candidate),
      localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === task.id
        ? { ...state.localLeaseByProjectId, [task.projectId]: null }
        : state.localLeaseByProjectId,
    }))
    await this.store.appendLifecycleReceipt(operation.id, {
      phase: cleanupMessage ? 'needsAttention' : 'archived',
      subphase: 'taskCommitted',
      recordedAt: Date.now(),
      receiptId: `${operation.id}:taskCommitted:archive`,
      details: { checkoutPath: worktree?.path },
    })
    if (!cleanupMessage && worktree && this.worktrees) {
      try {
        await this.worktrees.purgeArchiveQuarantine(operation.id, worktree.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Archive quarantine cleanup failed'
        await this.markOperationNeedsAttention(operation.id, 'ARCHIVE_FINALIZATION_BLOCKED', message)
        return { task: this.requireTask(task.id), warning: { kind: 'cleanupBlocked', message } }
      }
    }
    return {
      task: this.requireTask(task.id),
      warning: cleanupMessage ? { kind: 'cleanupBlocked', message: cleanupMessage } : null,
    }
  }

  private async retryArchiveCleanup(task: Task): Promise<TaskLifecycleResult> {
    const lifecycle = this.requireLifecycle()
    const worktree = this.worktreeForTask(task)
    if (!worktree || !this.worktrees || !task.lifecycleOperationId) {
      return { task, warning: { kind: 'cleanupBlocked', message: 'Worktree cleanup needs attention' } }
    }
    await lifecycle.activity.assertIdle(task, worktree)
    const operationId = task.lifecycleOperationId
    await this.store.updateLifecycleOperation(operationId, (operation) => ({
      ...operation,
      status: 'running',
      phase: 'intentPersisted',
      updatedAt: Date.now(),
      lastError: null,
    }))

    try {
      const prepared = await this.worktrees.prepareArchive({
        operationId,
        worktreeId: worktree.id,
        snapshotStore: lifecycle.snapshots,
      })
      await this.worktrees.removePreparedArchive({
        operationId,
        worktreeId: worktree.id,
        repositoryPath: lifecycle.repositoryPath(task.projectId),
        snapshotStore: lifecycle.snapshots,
        snapshot: prepared.snapshot,
      })
      const now = Date.now()
      await this.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
          ...candidate, state: 'archived' as const, updatedAt: now,
        } : candidate),
        managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
          ...candidate,
          lifecycle: 'removed' as const,
          cleanupReason: null,
          archiveHeadSha: prepared.headSha,
          headSha: prepared.headSha,
          privateRef: prepared.privateRef,
          snapshot: prepared.snapshot,
          updatedAt: now,
        } : candidate),
        lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operationId ? {
          ...candidate,
          status: 'completed' as const,
          phase: 'archived' as const,
          updatedAt: now,
          lastError: null,
        } : candidate),
      }))
      await this.worktrees.purgeArchiveQuarantine(operationId, worktree.id)
      return { task: this.requireTask(task.id), warning: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Worktree cleanup failed'
      await this.markOperationNeedsAttention(operationId, 'WORKTREE_CLEANUP_BLOCKED', message)
      await this.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
          ...candidate, state: 'cleanupBlocked' as const, updatedAt: Date.now(),
        } : candidate),
        managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
          ...candidate, lifecycle: 'cleanupBlocked' as const, cleanupReason: message, updatedAt: Date.now(),
        } : candidate),
      }))
      return { task: this.requireTask(task.id), warning: { kind: 'cleanupBlocked', message } }
    }
  }

  async unarchive(taskId: string): Promise<TaskLifecycleResult> {
    const task = this.requireTask(taskId)
    if (task.state !== 'archived') throw new Error('Task is not ready to restore')
    const lifecycle = this.requireLifecycle()
    if (!task.worktreeId) {
      const operation = await this.store.beginLifecycleOperation({
        kind: 'restore', taskId: task.id, worktreeId: null, artifactId: null,
        restoreReservation: null, startedAt: Date.now(),
      })
      if (task.threadId) {
        await this.runThreadRpc(operation.id, 'unarchiveThread', task.threadId, () => lifecycle.codex.unarchiveThread(task.threadId as string))
      }
      const restored = await this.patchTask(taskId, {
        state: 'local', archivedAt: null, handoff: null, lifecycleOperationId: operation.id,
      })
      await this.completeOperation(operation.id, 'restored')
      return { task: restored, warning: null }
    }
    if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
    const worktree = this.worktreeForTask(task)
    if (!worktree?.snapshot || worktree.lifecycle !== 'removed' || !worktree.privateRef) {
      throw new Error('Archived worktree cleanup must complete before this session can be restored')
    }
    await lifecycle.activity.assertIdle(task, worktree)
    const operation = await this.store.beginLifecycleOperation({
      kind: 'restore', taskId: task.id, worktreeId: worktree.id,
      artifactId: worktree.snapshot.artifactId,
      restoreReservation: {
        path: worktree.path,
        gitCommonDir: worktree.gitCommonDir,
        privateRef: worktree.privateRef,
        ownershipToken: crypto.randomUUID(),
        reservedAt: Date.now(),
      },
      startedAt: Date.now(),
    })
    try {
      const restored = await this.worktrees.restorePreparedArchive({
        operationId: operation.id,
        worktreeId: worktree.id,
        repositoryPath: lifecycle.repositoryPath(task.projectId),
        snapshotStore: lifecycle.snapshots,
        snapshot: worktree.snapshot,
      })
      if (worktree.environmentRevision) {
        await lifecycle.restoreEnvironment(task, worktree, worktree.environmentRevision)
        await this.store.appendLifecycleReceipt(operation.id, {
          phase: 'restoreEnvironment', subphase: 'environmentRestored', recordedAt: Date.now(),
          receiptId: `${operation.id}:environmentRestored:${worktree.environmentRevision}`,
          details: { checkoutPath: restored.checkoutPath },
        })
      }
      if (task.threadId) {
        await this.runThreadRpc(operation.id, 'unarchiveThread', task.threadId, () => lifecycle.codex.unarchiveThread(task.threadId as string))
      }
      const now = Date.now()
      await this.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
          ...candidate, checkoutId: worktree.checkoutId, location: 'worktree' as const,
          state: 'active' as const, archivedAt: null, handoff: null,
          lifecycleOperationId: operation.id, updatedAt: now,
        } : candidate),
        managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
          ...candidate, lifecycle: 'active' as const, cleanupReason: null,
          archivedAt: null, updatedAt: now,
        } : candidate),
        lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
          ...candidate, status: 'running' as const, phase: 'restored' as const,
          updatedAt: now, lastError: null,
        } : candidate),
      }))
      await this.store.appendLifecycleReceipt(operation.id, {
        phase: 'restored', subphase: 'taskCommitted', recordedAt: Date.now(),
        receiptId: `${operation.id}:taskCommitted:restore`, details: { checkoutPath: restored.checkoutPath },
      })
      await this.worktrees.retireRestoredSnapshot({
        operationId: operation.id,
        worktreeId: worktree.id,
        repositoryPath: lifecycle.repositoryPath(task.projectId),
        snapshotStore: lifecycle.snapshots,
        snapshot: worktree.snapshot,
      })
      await this.store.update((state) => ({
        ...state,
        managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
          ...candidate,
          snapshot: null,
          privateRef: null,
          archiveHeadSha: null,
          updatedAt: Date.now(),
        } : candidate),
      }))
      await this.completeOperation(operation.id, 'restored')
      return {
        task: this.requireTask(task.id),
        warning: restored.fallbackReason ? { kind: 'restoreFallback', message: restored.fallbackReason } : null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Session restoration failed'
      await this.markOperationNeedsAttention(operation.id, 'RESTORE_BLOCKED', message)
      const now = Date.now()
      await this.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
          ...candidate, state: 'needsAttention' as const, lifecycleOperationId: operation.id, updatedAt: now,
        } : candidate),
        managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
          ...candidate, lifecycle: 'needsAttention' as const, cleanupReason: message, updatedAt: now,
        } : candidate),
      }))
      throw error
    }
  }

  async delete(taskId: string): Promise<void> {
    const task = this.requireTask(taskId)
    this.assertHandoffComplete(task)
    if (!task.archivedAt || !['archived', 'cleanupBlocked', 'needsAttention'].includes(task.state)) {
      throw new Error('Archive this session before deleting it')
    }
    const lifecycle = this.requireLifecycle()
    const worktree = this.worktreeForTask(task)
    await lifecycle.activity.assertIdle(task, worktree)
    if (worktree && (worktree.lifecycle !== 'removed' || !worktree.snapshot || !worktree.privateRef)) {
      throw new Error('Worktree cleanup must complete before deleting this archived session')
    }
    const archiveOperation = worktree ? this.store.read().lifecycleOperations
      .filter((candidate) => candidate.kind === 'archive' && candidate.taskId === task.id && candidate.worktreeId === worktree.id)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] : null
    const quarantinePath = archiveOperation?.receipts.find((receipt) => receipt.details?.quarantinePath)?.details?.quarantinePath
      ?? (worktree ? `${worktree.recordedRoot}/.cranberri/quarantine/${archiveOperation?.id ?? 'missing'}` : null)
    const operation = await this.store.beginLifecycleOperation({
      kind: 'delete', taskId: task.id, worktreeId: worktree?.id ?? null,
      artifactId: worktree?.snapshot?.artifactId ?? null,
      purgeSelectors: {
        threadId: task.threadId,
        taskIds: [task.id],
        worktreeIds: worktree ? [worktree.id] : [],
        artifactIds: worktree?.snapshot ? [worktree.snapshot.artifactId] : [],
        privateRefs: worktree?.privateRef ? [worktree.privateRef] : [],
        quarantinePaths: quarantinePath ? [quarantinePath] : [],
        snapshotPaths: worktree?.snapshot ? [worktree.snapshot.artifactPath] : [],
        ownershipManifestPaths: worktree ? [worktree.manifestPath] : [],
        pinIds: [],
      },
      startedAt: Date.now(),
    })
    if (task.threadId) {
      await this.runThreadRpc(operation.id, 'deleteThread', task.threadId, () => lifecycle.codex.deleteThread(task.threadId as string))
    }
    if (worktree?.snapshot) {
      if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
      try {
        await this.worktrees.purgeOwnedArtifacts({
          operationId: operation.id,
          worktreeId: worktree.id,
          repositoryPath: lifecycle.repositoryPath(task.projectId),
          snapshotStore: lifecycle.snapshots,
          snapshot: worktree.snapshot,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Local restore material could not be purged'
        await this.markOperationNeedsAttention(operation.id, 'PURGE_PENDING', message)
        throw new Error('Conversation deleted, but local cleanup is still pending', { cause: error })
      }
    }
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.filter((candidate) => candidate.id !== taskId),
      managedWorktrees: state.managedWorktrees.filter((candidate) => candidate.id !== worktree?.id),
      lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
        ...candidate, status: 'completed' as const, phase: 'completed' as const,
        updatedAt: Date.now(), lastError: null,
      } : candidate),
      localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === taskId
        ? { ...state.localLeaseByProjectId, [task.projectId]: null }
        : state.localLeaseByProjectId,
    }))
  }

  private requireLifecycle(): TaskLifecycleDependencies {
    if (!this.lifecycle) throw new Error('Task lifecycle coordination is unavailable')
    return this.lifecycle
  }

  private worktreeForTask(task: Task): ManagedWorktree | null {
    if (!task.worktreeId) return null
    const worktree = this.store.read().managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
    if (!worktree || worktree.taskId !== task.id || worktree.projectId !== task.projectId) {
      throw new Error('Task worktree ownership mismatch')
    }
    return worktree
  }

  private async runThreadRpc(
    operationId: string,
    action: LifecycleRpcOutcome['action'],
    threadId: string,
    request: () => Promise<unknown>,
  ): Promise<void> {
    const requestedAt = Date.now()
    await this.store.updateLifecycleOperation(operationId, (operation) => ({
      ...operation,
      status: 'running',
      phase: action === 'archiveThread' ? 'threadArchiveRequested'
        : action === 'unarchiveThread' ? 'threadUnarchiveRequested'
          : 'threadDeleteRequested',
      rpc: { action, status: 'requested', requestedAt, observedAt: null },
      updatedAt: requestedAt,
    }))
    await this.store.appendLifecycleReceipt(operationId, {
      phase: action === 'archiveThread' ? 'threadArchiveRequested'
        : action === 'unarchiveThread' ? 'threadUnarchiveRequested'
          : 'threadDeleteRequested',
      subphase: 'rpcRequested',
      recordedAt: requestedAt,
      receiptId: `${operationId}:rpcRequested:${action}`,
      details: { rpcRequestId: operationId, threadId },
    })
    try {
      await request()
    } catch (error) {
      const message = error instanceof Error ? error.message : `Codex ${action} failed`
      await this.store.updateLifecycleOperation(operationId, (operation) => ({
        ...operation,
        status: 'needsAttention',
        phase: 'needsAttention',
        rpc: operation.rpc ? { ...operation.rpc, status: 'unknown' } : null,
        updatedAt: Date.now(),
        lastError: { code: 'CODEX_RPC_UNKNOWN', message, recordedAt: Date.now() },
      }))
      throw error
    }
    const observedAt = Date.now()
    await this.store.updateLifecycleOperation(operationId, (operation) => ({
      ...operation,
      status: 'running',
      phase: action === 'archiveThread' ? 'threadArchived'
        : action === 'unarchiveThread' ? 'threadUnarchived'
          : 'threadDeleted',
      rpc: operation.rpc ? { ...operation.rpc, status: 'observed', observedAt } : null,
      updatedAt: observedAt,
      lastError: null,
    }))
    await this.store.appendLifecycleReceipt(operationId, {
      phase: action === 'archiveThread' ? 'threadArchived'
        : action === 'unarchiveThread' ? 'threadUnarchived'
          : 'threadDeleted',
      subphase: 'rpcObserved',
      recordedAt: observedAt,
      receiptId: `${operationId}:rpcObserved:${action}`,
      details: { rpcRequestId: operationId, threadId },
    })
  }

  private async markOperationNeedsAttention(operationId: string, code: string, message: string): Promise<void> {
    await this.store.updateLifecycleOperation(operationId, (operation) => ({
      ...operation,
      status: 'needsAttention',
      phase: 'needsAttention',
      retry: { ...operation.retry, attempt: operation.retry.attempt + 1 },
      updatedAt: Date.now(),
      lastError: { code, message, recordedAt: Date.now() },
    }))
  }

  private async completeOperation(operationId: string, phase: LifecycleOperation['phase']): Promise<void> {
    await this.store.updateLifecycleOperation(operationId, (operation) => ({
      ...operation,
      status: 'completed',
      phase,
      updatedAt: Date.now(),
      lastError: null,
    }))
  }

  private requireTask(taskId: string): Task {
    const task = this.store.read().tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Task not found')
    return task
  }

  private assertHandoffComplete(task: Task): void {
    if (task.location === 'local' && task.worktreeId) {
      throw new Error('Return this session to its worktree before archiving or deleting it')
    }
  }

  private requireTransition(taskId: string): NonNullable<Task['worktreeTransition']> {
    const transition = this.requireTask(taskId).worktreeTransition
    if (!transition) throw new Error('Task has no worktree transition')
    return transition
  }

  private async patchTask(taskId: string, patch: Partial<Task>): Promise<Task> {
    let updated: Task | undefined
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task
        updated = { ...task, ...patch, updatedAt: Date.now() }
        return updated
      }),
    }))
    if (!updated) throw new Error('Task not found')
    return updated
  }
}
