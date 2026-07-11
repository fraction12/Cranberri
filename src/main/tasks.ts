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
  includeLocalChanges?: boolean
}

export interface WorktreeProvisioningContext {
  projectName: string
  localCheckoutId: string
  localCheckoutPath: string
  managedRoot: string
  cap: number
}

export class TaskCoordinator {
  constructor(
    private readonly store = new TaskStore(),
    private readonly worktrees?: WorktreeLifecycle,
  ) {}

  async ensureControlTasks(registry: ProjectRegistry, now = Date.now()): Promise<Task[]> {
    const localCheckoutById = new Map(
      registry.checkouts.map((checkout) => [checkout.id, checkout]),
    )

    await this.store.update((state) => {
      const tasks = [...state.tasks]
      for (const project of registry.projects) {
        if (tasks.some((task) => task.id === project.controlTaskId)) continue
        const checkout = localCheckoutById.get(project.localCheckoutId)
        if (!checkout) throw new Error(`Local checkout missing for project ${project.id}`)
        tasks.push({
          id: project.controlTaskId,
          projectId: project.id,
          threadId: null,
          checkoutId: checkout.id,
          worktreeId: null,
          role: 'control',
          location: 'local',
          state: 'local',
          baseRef: project.pinnedLocalBranch
            ? `refs/heads/${project.pinnedLocalBranch}`
            : null,
          baseSha: null,
          environmentId: null,
          environmentRevision: null,
          pendingFirstTurn: null,
          createdAt: now,
          updatedAt: now,
        })
      }
      return { ...state, tasks }
    })

    return this.store.read().tasks.filter((task) => task.role === 'control')
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
    if (task.role === 'control') throw new Error('The Local control task cannot be archived')
    await this.releaseLocalLease(task.projectId, task.id)
    return this.patchTask(taskId, { state: 'archived', archivedAt: Date.now() })
  }

  private requireTask(taskId: string): Task {
    const task = this.store.read().tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Task not found')
    return task
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
