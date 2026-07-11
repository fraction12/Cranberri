import type { Checkout, Project } from '@/shared/projects'
import type { Task } from '@/shared/tasks'
import type { WorkspaceWindowState } from '@/shared/appState'

export interface TaskExecutionContext {
  projectId: string
  taskId: string | null
  checkoutId: string
  worktreeId: string | null
  checkoutPath: string
}

export interface UnavailableExecutionContext {
  status: 'unavailable'
  reason: 'project-missing' | 'checkout-missing' | 'checkout-unavailable' | 'task-missing' | 'task-mismatch'
  projectId: string
  taskId: string | null
  checkoutId: string | null
}

export interface AvailableExecutionContext {
  status: 'available'
  context: TaskExecutionContext
}

export type ExecutionContextResolution = AvailableExecutionContext | UnavailableExecutionContext

export interface ExecutionCatalog {
  projects: Project[]
  checkouts: Checkout[]
  tasks: Task[]
}

export function resolveTaskExecutionContext(
  binding: Pick<WorkspaceWindowState, 'projectId' | 'taskId' | 'checkoutId'>,
  catalog: ExecutionCatalog,
): ExecutionContextResolution {
  const projectId = binding.projectId ?? ''
  const taskId = binding.taskId ?? null
  const checkoutId = binding.checkoutId ?? null
  const project = catalog.projects.find((candidate) => candidate.id === projectId)
  if (!project) return { status: 'unavailable', reason: 'project-missing', projectId, taskId, checkoutId }

  const task = taskId ? catalog.tasks.find((candidate) => candidate.id === taskId) : null
  if (taskId && !task) return { status: 'unavailable', reason: 'task-missing', projectId, taskId, checkoutId }
  if (task && (task.projectId !== projectId || task.checkoutId !== checkoutId)) {
    return { status: 'unavailable', reason: 'task-mismatch', projectId, taskId, checkoutId }
  }

  const checkout = catalog.checkouts.find((candidate) => candidate.id === checkoutId && candidate.projectId === projectId)
  if (!checkout) return { status: 'unavailable', reason: 'checkout-missing', projectId, taskId, checkoutId }
  if (!checkout.available) return { status: 'unavailable', reason: 'checkout-unavailable', projectId, taskId, checkoutId }

  return {
    status: 'available',
    context: {
      projectId,
      taskId,
      checkoutId: checkout.id,
      worktreeId: task?.worktreeId ?? null,
      checkoutPath: checkout.canonicalPath,
    },
  }
}

export function bindWindowExecutionContext(
  window: WorkspaceWindowState,
  context: TaskExecutionContext,
): WorkspaceWindowState {
  return {
    ...window,
    projectId: context.projectId,
    taskId: context.taskId,
    checkoutId: context.checkoutId,
  }
}
