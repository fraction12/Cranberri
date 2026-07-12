import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { CodexTurnSettings, CodexUserInput } from '@/shared/codex'
import type { EnvironmentRecord } from '@/shared/environments'
import type { Checkout, Project } from '@/shared/projects'
import type { EnvironmentJob } from '@/shared/terminal'
import type { LocalTaskDraftRequest, Task, TaskDraftRequest, TaskHandoffRequest } from '@/shared/tasks'
import type { GitRef, ManagedWorktree, RefRefreshResult } from '@/shared/worktrees'
import type { TaskExecutionContext } from './execution-context'

export interface TaskCatalogSnapshot {
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

export async function provisionAndSendFirstTurn(
  api: WorktreeSubmissionApi,
  submission: WorktreeSubmission,
  onOperation: (operation: TaskOperation) => void,
  existingTask?: Task,
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
    let job: EnvironmentJob | null = null
    try {
      job = await api.startSetup(task.id)
      onOperation({ phase: 'setup', taskId: task.id, job, error: null })
      job = await api.waitForSetup(job, (next) => {
        onOperation({ phase: 'setup', taskId: task.id, job: next, error: null })
      })
      if (job.status !== 'succeeded') throw new Error(`Environment setup ${job.status}`)
    } catch (error) {
      onOperation({
        phase: 'setupFailed',
        taskId: task.id,
        job,
        error: errorMessage(error),
      })
      throw error
    }
  }

  const sent = await api.send(task.id, submission.draft.input as CodexUserInput[], submission.settings)
  onOperation({ phase: 'idle', taskId: sent.id, job: null, error: null })
  return sent
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Task operation failed'
}

const EMPTY_SNAPSHOT: TaskCatalogSnapshot = { projects: [], checkouts: [], tasks: [], managedWorktrees: [] }
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
  submitLocal: (draft: LocalTaskDraftRequest, settings?: CodexTurnSettings) => Promise<Task>
  submitWorktree: (submission: WorktreeSubmission) => Promise<Task>
  retryProvisioning: (settings?: CodexTurnSettings) => Promise<Task>
  cancelSetup: () => Promise<void>
  handoffToLocal: (request: TaskHandoffRequest) => Promise<Task>
  handoffToWorktree: (request: TaskHandoffRequest) => Promise<Task>
  continueInWorktree: (taskId: string) => Promise<Task>
  archive: (taskId: string) => Promise<Task>
  unarchive: (taskId: string) => Promise<Task>
}

const TasksContext = createContext<TasksApi | null>(null)

export function selectableRootTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.role !== 'worker' && task.state !== 'removed')
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
}

export function taskExecutionContext(task: Task, checkouts: Checkout[]): TaskExecutionContext | null {
  const checkout = checkouts.find((candidate) => candidate.id === task.checkoutId && candidate.projectId === task.projectId)
  if (!checkout?.available) return null
  return { projectId: task.projectId, taskId: task.id, checkoutId: checkout.id, worktreeId: task.worktreeId, checkoutPath: checkout.canonicalPath }
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
  const [liveSnapshot, setLiveSnapshot] = useState<TaskCatalogSnapshot>(snapshot ?? EMPTY_SNAPSHOT)
  const [activeTaskId, setActiveTask] = useState<string | null>(null)
  const [loading, setLoading] = useState(snapshot === undefined)
  const [operation, setOperation] = useState<TaskOperation>(IDLE_OPERATION)
  const [lastSubmission, setLastSubmission] = useState<WorktreeSubmission | null>(null)

  const refresh = useCallback(async () => {
    if (snapshot) { setLiveSnapshot(snapshot); return }
    const next = await window.cranberri.tasks.snapshot()
    setLiveSnapshot(next)
  }, [snapshot])

  useEffect(() => {
    refresh().catch((error) => console.error('Failed to load tasks:', error)).finally(() => setLoading(false))
  }, [refresh])

  const submissionApi = useMemo<WorktreeSubmissionApi>(() => ({
    createDraft: async (request) => (await window.cranberri.tasks.createWorktreeDraft(request)).task,
    provision: async (taskId, includeLocalChanges) => (await window.cranberri.tasks.provision({ taskId, includeLocalChanges })).task,
    startSetup: (taskId) => window.cranberri.environments.startSetup({ taskId }),
    waitForSetup: waitForEnvironmentJob,
    send: async (taskId, input, settings) => (await window.cranberri.tasks.send({ taskId, input, settings })).task,
  }), [])

  const submitWorktree = useCallback(async (submission: WorktreeSubmission) => {
    setLastSubmission(submission)
    setOperation({ phase: 'creating', taskId: null, job: null, error: null })
    try {
      const task = await provisionAndSendFirstTurn(submissionApi, submission, setOperation)
      setActiveTask(task.id)
      await refresh()
      return task
    } finally {
      await refresh().catch(() => undefined)
    }
  }, [refresh, submissionApi])

  const runAndRefresh = useCallback(async (run: () => Promise<{ task: Task }>) => {
    const result = await run()
    setActiveTask(result.task.id)
    await refresh()
    return result.task
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
      submitLocal: async (draft, settings) => {
        const { task } = await window.cranberri.tasks.createLocalDraft(draft)
        const sent = (await window.cranberri.tasks.send({ taskId: task.id, input: draft.input, settings })).task
        setActiveTask(sent.id)
        await refresh()
        return sent
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
      continueInWorktree: (taskId) => runAndRefresh(() => window.cranberri.tasks.continueInWorktree(taskId)),
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
