import { createContext, useContext, useMemo, useState } from 'react'
import type { Checkout, Project } from '@/shared/projects'
import type { Task } from '@/shared/tasks'
import type { TaskExecutionContext } from './execution-context'

export interface TaskCatalogSnapshot {
  projects: Project[]
  checkouts: Checkout[]
  tasks: Task[]
}

export interface TasksApi extends TaskCatalogSnapshot {
  activeTaskId: string | null
  activeTask: Task | null
  rootTasks: Task[]
  setActiveTask: (taskId: string | null) => void
  executionContextForTask: (taskId: string) => TaskExecutionContext | null
}

const EMPTY_SNAPSHOT: TaskCatalogSnapshot = { projects: [], checkouts: [], tasks: [] }
const TasksContext = createContext<TasksApi | null>(null)

export function selectableRootTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.role !== 'worker' && task.state !== 'removed')
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
}

export function taskExecutionContext(task: Task, checkouts: Checkout[]): TaskExecutionContext | null {
  const checkout = checkouts.find((candidate) => candidate.id === task.checkoutId && candidate.projectId === task.projectId)
  if (!checkout?.available) return null
  return {
    projectId: task.projectId,
    taskId: task.id,
    checkoutId: checkout.id,
    worktreeId: task.worktreeId,
    checkoutPath: checkout.canonicalPath,
  }
}

export function TasksProvider({
  children,
  snapshot = EMPTY_SNAPSHOT,
}: {
  children: React.ReactNode
  snapshot?: TaskCatalogSnapshot
}) {
  const [activeTaskId, setActiveTask] = useState<string | null>(null)
  const value = useMemo<TasksApi>(() => {
    const activeTask = snapshot.tasks.find((task) => task.id === activeTaskId) ?? null
    return {
      ...snapshot,
      activeTaskId: activeTask?.id ?? null,
      activeTask,
      rootTasks: selectableRootTasks(snapshot.tasks),
      setActiveTask,
      executionContextForTask: (taskId) => {
        const task = snapshot.tasks.find((candidate) => candidate.id === taskId)
        return task ? taskExecutionContext(task, snapshot.checkouts) : null
      },
    }
  }, [activeTaskId, snapshot])

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks(): TasksApi {
  const context = useContext(TasksContext)
  if (!context) throw new Error('useTasks must be used inside TasksProvider')
  return context
}

export function useOptionalTasks(): TasksApi | null {
  return useContext(TasksContext)
}
