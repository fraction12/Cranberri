import type { ProjectRegistry } from '../shared/projects'
import type { CodexRuntimeContext, CodexUserInput } from '../shared/codex'
import type { PendingFirstTurn, Task } from '../shared/tasks'
import type { WorktreeLifecycle } from './worktree-lifecycle'
import { TaskStore } from './task-store'

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

interface TaskCodexLifecycle {
  archiveThread(threadId: string): Promise<void>
  unarchiveThread(threadId: string): Promise<unknown>
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
    private readonly codex?: TaskCodexLifecycle,
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

  async archive(taskId: string): Promise<Task> {
    const task = this.requireTask(taskId)
    this.assertHandoffComplete(task)
    if (task.threadId && this.codex) await this.codex.archiveThread(task.threadId)
    if (task.worktreeId && this.worktrees) await this.worktrees.archive(task.worktreeId)
    await this.releaseLocalLease(task.projectId, task.id)
    return this.patchTask(taskId, { state: 'archived', archivedAt: Date.now(), handoff: null })
  }

  async unarchive(taskId: string, localCheckoutPath: string, runEnvironment?: (worktree: import('../shared/worktrees').ManagedWorktree, revision: string) => Promise<void>): Promise<Task> {
    const task = this.requireTask(taskId)
    if (task.state !== 'archived') throw new Error('Task is not archived')
    if (!task.worktreeId) {
      if (task.threadId && this.codex) await this.codex.unarchiveThread(task.threadId)
      return this.patchTask(taskId, { state: 'local', archivedAt: null, handoff: null })
    }
    if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
    const worktree = await this.worktrees.restore(task.worktreeId, localCheckoutPath, runEnvironment)
    if (task.threadId && this.codex) await this.codex.unarchiveThread(task.threadId)
    return this.patchTask(taskId, {
      checkoutId: worktree.checkoutId,
      location: 'worktree',
      state: 'active',
      archivedAt: null,
      handoff: null,
    })
  }

  async delete(taskId: string, deleteThread: (threadId: string) => Promise<void>): Promise<void> {
    const task = this.requireTask(taskId)
    this.assertHandoffComplete(task)
    if (task.worktreeId) {
      if (!this.worktrees) throw new Error('Worktree lifecycle is unavailable')
      await this.worktrees.remove(task.worktreeId)
    }
    if (task.threadId) await deleteThread(task.threadId)
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.filter((candidate) => candidate.id !== taskId),
      localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === taskId
        ? { ...state.localLeaseByProjectId, [task.projectId]: null }
        : state.localLeaseByProjectId,
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
