import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CodexTurnSettings, CodexUserInput } from '@/shared/codex'
import type { EnvironmentRecord } from '@/shared/environments'
import type { Checkout, Project } from '@/shared/projects'
import type { EnvironmentJob } from '@/shared/terminal'
import type { LocalTaskDraftRequest, Task, TaskDraftRequest, TaskHandoffRequest } from '@/shared/tasks'
import type { GitRef, ManagedWorktree, RefRefreshResult } from '@/shared/worktrees'
import type { AuthorityChangedEvent } from '@/shared/state-events'
import type { TaskExecutionContext } from './execution-context'
import { useRepos } from './repos'

export interface TaskCatalogSnapshot {
  revision: number
  projects: Project[]
  checkouts: Checkout[]
  tasks: Task[]
  managedWorktrees?: ManagedWorktree[]
}

export type TaskOperationPhase = 'idle' | 'creating' | 'setup' | 'worktreeFailed' | 'setupFailed'
export interface TaskOperation {
  phase: TaskOperationPhase
  taskId: string | null
  job: EnvironmentJob | null
  error: string | null
}

export interface WorktreeSubmission {
  draft: TaskDraftRequest
  includeLocalChanges: boolean
  settings?: CodexTurnSettings
}

export interface WorktreeSubmissionApi {
  createDraft(request: TaskDraftRequest): Promise<Task>
  provision(taskId: string, includeLocalChanges: boolean): Promise<Task>
  startSetup(taskId: string): Promise<EnvironmentJob>
  waitForSetup(job: EnvironmentJob, onUpdate: (job: EnvironmentJob) => void): Promise<EnvironmentJob>
  send(taskId: string, input: CodexUserInput[], settings?: CodexTurnSettings): Promise<Task>
}

export interface WorktreeContinuationResult {
  task: Task
  warning: string | null
  includedLocalChanges: boolean
}

export async function provisionAndSendFirstTurn(
  api: WorktreeSubmissionApi,
  submission: WorktreeSubmission,
  onOperation: (operation: TaskOperation) => void,
  existingTask?: Task,
  beforeSend?: (task: Task) => Promise<Task>,
): Promise<Task> {
  let task: Task | undefined = existingTask
  try {
    task ??= await api.createDraft(submission.draft)
    onOperation({ phase: 'creating', taskId: task.id, job: null, error: null })
    if (!task.worktreeId) {
      task = await api.provision(task.id, submission.includeLocalChanges)
    }
  } catch (error) {
    onOperation({
      phase: 'worktreeFailed',
      taskId: task?.id ?? null,
      job: null,
      error: errorMessage(error),
    })
    throw error
  }

  if (task.environmentRevision) {
    const setupTask = task
    let job: EnvironmentJob | null = null
    try {
      job = await api.startSetup(setupTask.id)
      onOperation({ phase: 'setup', taskId: setupTask.id, job, error: null })
      job = await api.waitForSetup(job, (next) => {
        onOperation({ phase: 'setup', taskId: setupTask.id, job: next, error: null })
      })
      if (job.status !== 'succeeded') throw new Error(`Environment setup ${job.status}`)
    } catch (error) {
      onOperation({
        phase: 'setupFailed',
        taskId: setupTask.id,
        job,
        error: errorMessage(error),
      })
      throw error
    }
  }

  if (beforeSend) task = await beforeSend(task)
  let sent: Task
  try {
    sent = await api.send(task.id, submission.draft.input as CodexUserInput[], submission.settings)
  } catch (error) {
    if (task.threadId && error && typeof error === 'object') Object.assign(error, { threadCreated: true })
    throw error
  }
  onOperation({ phase: 'idle', taskId: sent.id, job: null, error: null })
  return sent
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Task operation failed'
}

const EMPTY_SNAPSHOT: TaskCatalogSnapshot = { revision: 0, projects: [], checkouts: [], tasks: [], managedWorktrees: [] }
const IDLE_OPERATION: TaskOperation = { phase: 'idle', taskId: null, job: null, error: null }

export interface TasksApi extends TaskCatalogSnapshot {
  activeTaskId: string | null
  activeTask: Task | null
  rootTasks: Task[]
  loading: boolean
  operation: TaskOperation
  setActiveTask: (taskId: string | null) => void
  executionContextForTask: (taskId: string) => TaskExecutionContext | null
  refresh: () => Promise<void>
  loadRefs: (projectId: string, refresh?: boolean) => Promise<{ refs: GitRef[]; refresh?: RefRefreshResult }>
  loadEnvironments: (projectId: string) => Promise<EnvironmentRecord[]>
  submitLocal: (draft: LocalTaskDraftRequest, settings?: CodexTurnSettings, onReady?: (task: Task) => Promise<void>) => Promise<Task>
  submitWorktree: (submission: WorktreeSubmission, onReady?: (task: Task) => Promise<void>) => Promise<Task>
  retryProvisioning: (settings?: CodexTurnSettings) => Promise<Task>
  cancelSetup: () => Promise<void>
  handoffToLocal: (request: TaskHandoffRequest) => Promise<Task>
  handoffToWorktree: (request: TaskHandoffRequest) => Promise<Task>
  continueInWorktree: (taskId: string) => Promise<WorktreeContinuationResult>
  retrySetup: (taskId: string) => Promise<Task>
  archive: (taskId: string) => Promise<Task>
  unarchive: (taskId: string) => Promise<Task>
}

const TasksContext = createContext<TasksApi | null>(null)

export function selectableRootTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.role !== 'worker' && task.state !== 'removed')
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
}

export function reduceTaskAuthorityRevision(current: number, event: AuthorityChangedEvent): number {
  return event.authority === 'tasks' && event.revision > current ? event.revision : current
}

export function reduceTaskCatalogSnapshot(
  current: TaskCatalogSnapshot,
  next: TaskCatalogSnapshot,
): TaskCatalogSnapshot {
  return next.revision < current.revision ? current : next
}

export function projectCatalogIdentity(
  projects: ReadonlyArray<{ id: string; localCheckoutId?: string; gitCommonDir?: string }>,
): string {
  return [...projects]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((project) => `${project.id}\0${project.localCheckoutId}\0${project.gitCommonDir}`)
    .join('\0')
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
    sessionTarget: task.location,
  }
}

function waitForEnvironmentJob(job: EnvironmentJob, onUpdate: (job: EnvironmentJob) => void): Promise<EnvironmentJob> {
  if (job.status !== 'running') return Promise.resolve(job)
  return new Promise((resolve, reject) => {
    let disposed = false
    const cleanup = () => {
      if (disposed) return
      disposed = true
      window.clearInterval(poll)
      unsubscribe()
      unsubscribeData()
    }
    const finish = (result: EnvironmentJob) => {
      cleanup()
      resolve(result)
    }
    const read = () => window.cranberri.environments.snapshotJob(job.id).then((snapshot) => {
      onUpdate(snapshot)
      if (snapshot.status !== 'running') finish(snapshot)
    }, (error) => {
      if (disposed) return
      cleanup()
      reject(error)
    })
    const unsubscribe = window.cranberri.environments.onJobExit((event) => {
      if (event.jobId !== job.id || disposed) return
      void read()
    })
    const unsubscribeData = window.cranberri.environments.onJobData((event) => {
      if (event.jobId !== job.id || disposed) return
      void read()
    })
    const poll = window.setInterval(() => { void read() }, 250)
    void read()
  })
}

export function TasksProvider({ children, snapshot }: { children: React.ReactNode; snapshot?: TaskCatalogSnapshot }) {
  const { projects } = useRepos()
  const [liveSnapshot, setLiveSnapshot] = useState<TaskCatalogSnapshot>(snapshot ?? EMPTY_SNAPSHOT)
  const authorityRevisionRef = useRef(snapshot?.revision ?? 0)
  const [activeTaskId, setActiveTask] = useState<string | null>(null)
  const [loading, setLoading] = useState(snapshot === undefined)
  const [operation, setOperation] = useState<TaskOperation>(IDLE_OPERATION)
  const [lastSubmission, setLastSubmission] = useState<WorktreeSubmission | null>(null)
  const projectCatalogKey = projectCatalogIdentity(projects)
  const previousProjectCatalogKeyRef = useRef(projectCatalogKey)

  const refresh = useCallback(async () => {
    const next = snapshot ?? await window.cranberri.tasks.snapshot()
    setLiveSnapshot((current) => {
      if (next.revision < authorityRevisionRef.current) return current
      authorityRevisionRef.current = Math.max(authorityRevisionRef.current, next.revision)
      return reduceTaskCatalogSnapshot(current, next)
    })
  }, [snapshot])

  useEffect(() => {
    refresh().catch((error) => console.error('Failed to load tasks:', error)).finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (previousProjectCatalogKeyRef.current === projectCatalogKey) return
    previousProjectCatalogKeyRef.current = projectCatalogKey
    void refresh().catch((error) => console.error('Failed to refresh tasks after project change:', error))
  }, [projectCatalogKey, refresh])

  useEffect(() => {
    return window.cranberri.tasks.onAuthorityChanged((event) => {
      const nextRevision = reduceTaskAuthorityRevision(authorityRevisionRef.current, event)
      if (nextRevision === authorityRevisionRef.current) return
      authorityRevisionRef.current = nextRevision
      void refresh().catch((error) => console.error('Failed to refresh tasks:', error))
    })
  }, [refresh])

  const submissionApi = useMemo<WorktreeSubmissionApi>(() => ({
    createDraft: async (request) => (await window.cranberri.tasks.createWorktreeDraft(request)).task,
    provision: async (taskId, includeLocalChanges) => (await window.cranberri.tasks.provision({ taskId, includeLocalChanges })).task,
    startSetup: (taskId) => window.cranberri.environments.startSetup({ taskId }),
    waitForSetup: waitForEnvironmentJob,
    send: async (taskId, input, settings) => (await window.cranberri.tasks.send({ taskId, input, settings })).task,
  }), [])

  const submitWorktree = useCallback(async (submission: WorktreeSubmission, onReady?: (task: Task) => Promise<void>) => {
    setLastSubmission(submission)
    setOperation({ phase: 'creating', taskId: null, job: null, error: null })
    try {
      const task = await provisionAndSendFirstTurn(submissionApi, submission, setOperation, undefined, async (provisioned) => {
        const ready = (await window.cranberri.tasks.resume(provisioned.id)).task
        setActiveTask(ready.id)
        await refresh()
        await onReady?.(ready)
        return ready
      })
      setActiveTask(task.id)
      await refresh()
      return task
    } finally {
      await refresh().catch(() => undefined)
    }
  }, [refresh, submissionApi])

  const runAndRefresh = useCallback(async (run: () => Promise<{ task: Task }>) => {
    try {
      const result = await run()
      setActiveTask(result.task.id)
      return result.task
    } finally {
      await refresh().catch(() => undefined)
    }
  }, [refresh])

  const value = useMemo<TasksApi>(() => {
    const activeTask = liveSnapshot.tasks.find((task) => task.id === activeTaskId) ?? null
    return {
      ...liveSnapshot,
      activeTaskId: activeTask?.id ?? null,
      activeTask,
      rootTasks: selectableRootTasks(liveSnapshot.tasks),
      loading,
      operation,
      setActiveTask,
      executionContextForTask: (taskId) => {
        const task = liveSnapshot.tasks.find((candidate) => candidate.id === taskId)
        return task ? taskExecutionContext(task, liveSnapshot.checkouts) : null
      },
      refresh,
      loadRefs: async (projectId, shouldRefresh = false) => shouldRefresh
        ? window.cranberri.worktrees.refreshRefs(projectId)
        : window.cranberri.worktrees.listRefs(projectId),
      loadEnvironments: async (projectId) => (await window.cranberri.environments.list(projectId)).environments,
      submitLocal: async (draft, settings, onReady) => {
        let task: Task | null = null
        try {
          task = (await window.cranberri.tasks.createLocalDraft(draft)).task
          task = (await window.cranberri.tasks.resume(task.id)).task
          setActiveTask(task.id)
          await refresh()
          await onReady?.(task)
          const sent = (await window.cranberri.tasks.send({ taskId: task.id, input: draft.input, settings })).task
          setActiveTask(sent.id)
          return sent
        } catch (error) {
          if (task?.threadId && error && typeof error === 'object') Object.assign(error, { threadCreated: true })
          throw error
        } finally {
          await refresh().catch(() => undefined)
        }
      },
      submitWorktree,
      retryProvisioning: async (settings) => {
        if (!lastSubmission || !operation.taskId) throw new Error('No failed task to retry')
        const existingTask = liveSnapshot.tasks.find((task) => task.id === operation.taskId)
        if (!existingTask) throw new Error('Failed task is no longer available')
        const submission = { ...lastSubmission, settings: settings ?? lastSubmission.settings }
        setOperation({
          phase: existingTask.worktreeId ? 'setup' : 'creating',
          taskId: existingTask.id,
          job: operation.job,
          error: null,
        })
        try {
          const task = await provisionAndSendFirstTurn(
            submissionApi,
            submission,
            setOperation,
            existingTask,
          )
          setActiveTask(task.id)
          await refresh()
          return task
        } finally {
          await refresh().catch(() => undefined)
        }
      },
      cancelSetup: async () => {
        if (!operation.job) return
        await window.cranberri.environments.cancelJob(operation.job.id)
      },
      handoffToLocal: (request) => runAndRefresh(() => window.cranberri.tasks.handoffToLocal(request)),
      handoffToWorktree: (request) => runAndRefresh(() => window.cranberri.tasks.handoffToWorktree(request)),
      continueInWorktree: async (taskId) => {
        try {
          const result = await window.cranberri.tasks.continueInWorktree(taskId)
          setActiveTask(result.task.id)
          return result
        } finally {
          await refresh().catch(() => undefined)
        }
      },
      retrySetup: async (taskId) => {
        try {
          const job = await window.cranberri.environments.startSetup({ taskId })
          const result = await waitForEnvironmentJob(job, () => undefined)
          if (result.status !== 'succeeded') throw new Error(`Environment setup ${result.status}`)
          return (await window.cranberri.tasks.status(taskId)).task
        } finally {
          await refresh().catch(() => undefined)
        }
      },
      archive: (taskId) => runAndRefresh(() => window.cranberri.tasks.archive(taskId)),
      unarchive: (taskId) => runAndRefresh(() => window.cranberri.tasks.unarchive(taskId)),
    }
  }, [activeTaskId, lastSubmission, liveSnapshot, loading, operation, refresh, runAndRefresh, submissionApi, submitWorktree])

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
