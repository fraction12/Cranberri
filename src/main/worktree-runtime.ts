import { EnvironmentRunner } from './environments/runner'
import { EnvironmentStore } from './environments/store'
import { TaskStore } from './task-store'
import { TaskCoordinator } from './tasks'
import { WorktreeLifecycle } from './worktree-lifecycle'

export const taskStore = new TaskStore()
export const worktreeLifecycle = new WorktreeLifecycle(taskStore)
export const environmentStore = new EnvironmentStore()
export const environmentRunner = new EnvironmentRunner({
  taskStore,
  worktrees: worktreeLifecycle,
  environmentStore,
})
export const taskCoordinator = new TaskCoordinator(taskStore, worktreeLifecycle)
