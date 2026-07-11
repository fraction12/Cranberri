import type { ProjectRegistry } from '../shared/projects'
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
