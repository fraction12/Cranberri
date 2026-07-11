import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ProjectRegistry } from '../../shared/projects'
import type { Task } from '../../shared/tasks'
import {
  environmentJobSchema,
  type EnvironmentActionRequest,
  type EnvironmentJob,
  type EnvironmentSetupRequest,
  type EnvironmentTestRequest,
  type TerminalIdentity,
} from '../../shared/terminal'
import type { ManagedWorktree } from '../../shared/worktrees'
import { readProjectRegistry } from '../repos'
import { readSettings } from '../settings'
import { TaskStore } from '../task-store'
import { createPtyJob, defaultShell, openIntegratedTerminal, type PtyJob } from '../terminal'
import { WorktreeLifecycle } from '../worktree-lifecycle'
import { resolveActionScript, resolveSetupScript } from './parser'
import { EnvironmentStore } from './store'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CORE_ENV_NAMES = process.platform === 'win32'
  ? ['ALLUSERSPROFILE', 'APPDATA', 'ComSpec', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE']
  : ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']

interface RunnerDependencies {
  environmentStore: EnvironmentStore
  taskStore: TaskStore
  worktrees: WorktreeLifecycle
  readProjects: () => ProjectRegistry
  readWorktreeSettings: () => { root: string; cap: number }
  logsRoot: string
  hostEnv: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

interface RunningJob {
  public: EnvironmentJob
  pty: PtyJob
  cancelled: boolean
  completion: Promise<EnvironmentJob>
}

export interface EnvironmentRunnerEvents {
  onData?: (jobId: string, data: string) => void
  onExit?: (job: EnvironmentJob) => void
}

function environmentPlatform(platform: NodeJS.Platform): 'macos' | 'windows' | 'linux' {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

function shellInvocation(script: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  const command = defaultShell(platform)
  return platform === 'win32'
    ? { command, args: ['-NoProfile', '-Command', script] }
    : { command, args: ['-lc', script] }
}

function safeSegment(value: string): string {
  if (!SAFE_ID.test(value)) throw new Error('Invalid environment execution identity')
  return value
}

export function buildEnvironmentVariables(input: {
  hostEnv: NodeJS.ProcessEnv
  inheritedNames: readonly string[]
  projectId: string
  projectName: string
  sourcePath: string
  worktreePath: string
  baseRef: string | null
  baseSha: string
}): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const name of new Set([...CORE_ENV_NAMES, ...input.inheritedNames])) {
    const value = input.hostEnv[name]
    if (value !== undefined) result[name] = value
  }
  return {
    ...result,
    CRANBERRI_SOURCE_TREE_PATH: input.sourcePath,
    CRANBERRI_WORKTREE_PATH: input.worktreePath,
    CODEX_SOURCE_TREE_PATH: input.sourcePath,
    CODEX_WORKTREE_PATH: input.worktreePath,
    CRANBERRI_PROJECT_ID: input.projectId,
    CRANBERRI_PROJECT_NAME: input.projectName,
    CRANBERRI_BASE_REF: input.baseRef ?? '',
    CRANBERRI_BASE_SHA: input.baseSha,
  }
}

export class EnvironmentRunner {
  private readonly dependencies: RunnerDependencies
  private readonly jobs = new Map<string, RunningJob>()
  private events: EnvironmentRunnerEvents = {}

  constructor(dependencies: Partial<RunnerDependencies> = {}) {
    const taskStore = dependencies.taskStore ?? new TaskStore()
    this.dependencies = {
      environmentStore: dependencies.environmentStore ?? new EnvironmentStore(),
      taskStore,
      worktrees: dependencies.worktrees ?? new WorktreeLifecycle(taskStore),
      readProjects: dependencies.readProjects ?? readProjectRegistry,
      readWorktreeSettings: dependencies.readWorktreeSettings ?? (() => {
        const settings = readSettings().worktrees
        return { root: settings.root, cap: settings.cap }
      }),
      logsRoot: dependencies.logsRoot ?? path.join(app.getPath('userData'), 'environment-logs'),
      hostEnv: dependencies.hostEnv ?? process.env,
      platform: dependencies.platform ?? process.platform,
    }
  }

  setEvents(events: EnvironmentRunnerEvents): void {
    this.events = events
  }

  async startSetup(request: EnvironmentSetupRequest): Promise<EnvironmentJob> {
    const task = this.requireTask(request.taskId)
    if (!task.environmentId || !task.environmentRevision) throw new Error('Task has no environment revision')
    const worktree = this.requireTaskWorktree(task)
    return this.startJob('setup', task, worktree, task.environmentId, task.environmentRevision)
  }

  retrySetup(request: EnvironmentSetupRequest): Promise<EnvironmentJob> {
    const running = [...this.jobs.values()].find((job) => job.public.identity.taskId === request.taskId && job.public.status === 'running')
    if (running) throw new Error('Environment setup is already running')
    return this.startSetup(request)
  }

  async testEnvironment(request: EnvironmentTestRequest): Promise<EnvironmentJob> {
    this.requireTrustedRevision(request.projectId, request.environmentId, request.revision)
    const registry = this.dependencies.readProjects()
    const project = registry.projects.find((candidate) => candidate.id === request.projectId)
    if (!project) throw new Error('Project not found')
    const local = registry.checkouts.find((checkout) => checkout.id === project.localCheckoutId && checkout.kind === 'local')
    if (!local?.available) throw new Error('Local checkout unavailable')
    const settings = this.dependencies.readWorktreeSettings()
    const taskId = `environment-test-${crypto.randomUUID()}`
    const now = Date.now()
    const draft: Task = {
      id: taskId,
      projectId: project.id,
      threadId: null,
      checkoutId: local.id,
      worktreeId: null,
      role: 'root',
      location: 'worktree',
      state: 'provisioning',
      baseRef: request.baseRef ?? project.pinnedLocalBranch ?? 'HEAD',
      baseSha: null,
      environmentId: request.environmentId,
      environmentRevision: request.revision,
      pendingFirstTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }
    await this.dependencies.taskStore.update((state) => ({ ...state, tasks: [...state.tasks, draft] }))
    const worktree = await this.dependencies.worktrees.create({
      projectId: project.id,
      projectName: project.name,
      taskId,
      taskName: 'environment-test',
      localCheckoutPath: local.canonicalPath,
      managedRoot: settings.root,
      baseRef: draft.baseRef ?? 'HEAD',
      cap: settings.cap,
    })
    const task = { ...draft, checkoutId: worktree.checkoutId, worktreeId: worktree.id, baseSha: worktree.baseSha, state: 'setup' as const, updatedAt: Date.now() }
    await this.replaceTask(task)
    return this.startJob('test', task, worktree, request.environmentId, request.revision)
  }

  openAction(request: EnvironmentActionRequest): { terminalId: string; pid: number } {
    const task = this.requireTask(request.taskId)
    if (!task.environmentId || !task.environmentRevision) throw new Error('Task has no environment revision')
    const { profile, project, localPath } = this.resolveExecution(task, task.environmentId, task.environmentRevision)
    const action = profile.actions.find((candidate) => candidate.id === request.actionId)
    if (!action) throw new Error('Environment action not found')
    const checkout = this.resolveCheckout(task)
    const script = resolveActionScript(action, environmentPlatform(this.dependencies.platform))
    const terminalId = `environment-action-${task.id}-${action.id}`
    const identity = this.identity(task)
    const env = buildEnvironmentVariables({
      hostEnv: this.dependencies.hostEnv,
      inheritedNames: profile.inherit,
      projectId: project.id,
      projectName: project.name,
      sourcePath: localPath,
      worktreePath: checkout,
      baseRef: task.baseRef,
      baseSha: task.baseSha ?? '',
    })
    const opened = openIntegratedTerminal({
      id: terminalId,
      cwd: checkout,
      script,
      env,
      process: {
        id: `environment-action:${task.id}:${action.id}`,
        command: `Environment action: ${action.name}`,
        cwd: checkout,
        terminalWindowId: terminalId,
        repoPath: checkout,
        ...identity,
        worktreeId: identity.worktreeId ?? undefined,
        kind: 'terminal',
        source: 'environment',
      },
    })
    return { terminalId, pid: opened.pid }
  }

  snapshot(jobId: string): EnvironmentJob {
    const running = this.jobs.get(jobId)
    if (!running) throw new Error('Environment job not found')
    running.public.output = running.pty.snapshot()
    return environmentJobSchema.parse(running.public)
  }

  latestForTask(taskId: string): EnvironmentJob | null {
    const jobs = [...this.jobs.values()]
      .map((job) => job.public)
      .filter((job) => job.identity.taskId === taskId)
      .sort((left, right) => right.startedAt - left.startedAt)
    return jobs[0] ? environmentJobSchema.parse(jobs[0]) : null
  }

  write(jobId: string, data: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.public.status !== 'running') throw new Error('Environment job is not running')
    job.pty.write(data)
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.public.status !== 'running') return
    job.cancelled = true
    job.pty.kill()
  }

  wait(jobId: string): Promise<EnvironmentJob> {
    const job = this.jobs.get(jobId)
    if (!job) return Promise.reject(new Error('Environment job not found'))
    return job.completion
  }

  private async startJob(
    kind: 'setup' | 'test',
    task: Task,
    worktree: ManagedWorktree,
    environmentId: string,
    revision: string,
  ): Promise<EnvironmentJob> {
    const { profile, project, localPath } = this.resolveExecution(task, environmentId, revision)
    const checkout = fs.realpathSync(worktree.path)
    const identity = this.identity(task)
    const id = crypto.randomUUID()
    const logPath = path.join(
      this.dependencies.logsRoot,
      safeSegment(project.id),
      safeSegment(task.id),
      `${safeSegment(id)}.log`,
    )
    const env = buildEnvironmentVariables({
      hostEnv: this.dependencies.hostEnv,
      inheritedNames: profile.inherit,
      projectId: project.id,
      projectName: project.name,
      sourcePath: localPath,
      worktreePath: checkout,
      baseRef: task.baseRef,
      baseSha: worktree.baseSha,
    })
    const invocation = shellInvocation(resolveSetupScript(profile, environmentPlatform(this.dependencies.platform)), this.dependencies.platform)
    const ptyJob = createPtyJob({
      cwd: checkout,
      ...invocation,
      env,
      logPath,
      process: {
        id: `environment:${id}`,
        command: `Environment ${kind}: ${profile.name}`,
        cwd: checkout,
        repoPath: checkout,
        ...identity,
        worktreeId: identity.worktreeId ?? undefined,
        kind: 'process',
        source: 'environment',
      },
    })
    const publicJob: EnvironmentJob = {
      id,
      kind,
      identity,
      environmentId,
      revision,
      status: 'running',
      pid: ptyJob.pid,
      output: '',
      logPath,
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
    }
    const running: RunningJob = { public: publicJob, pty: ptyJob, cancelled: false, completion: Promise.resolve(publicJob) }
    ptyJob.onData((data) => this.events.onData?.(id, data))
    running.completion = ptyJob.completion.then(async ({ exitCode, signal }) => {
      publicJob.output = ptyJob.snapshot()
      publicJob.status = running.cancelled ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed'
      publicJob.endedAt = Date.now()
      publicJob.exitCode = exitCode
      publicJob.signal = signal ?? null
      await this.finishTask(task, worktree, publicJob)
      this.events.onExit?.(environmentJobSchema.parse(publicJob))
      return environmentJobSchema.parse(publicJob)
    })
    this.jobs.set(id, running)
    await this.updateExecutionState(task, worktree, 'setup')
    return environmentJobSchema.parse(publicJob)
  }

  private resolveExecution(task: Task, environmentId: string, revision: string) {
    this.requireTrustedRevision(task.projectId, environmentId, revision)
    const registry = this.dependencies.readProjects()
    const project = registry.projects.find((candidate) => candidate.id === task.projectId)
    if (!project) throw new Error('Project not found')
    const local = registry.checkouts.find((checkout) => checkout.id === project.localCheckoutId && checkout.kind === 'local')
    if (!local?.available) throw new Error('Local checkout unavailable')
    return {
      profile: this.dependencies.environmentStore.readRevision(task.projectId, environmentId, revision),
      project,
      localPath: fs.realpathSync(local.canonicalPath),
    }
  }

  private requireTrustedRevision(projectId: string, environmentId: string, revision: string): void {
    const manifest = this.dependencies.environmentStore.readManifest(projectId, environmentId)
    if (manifest.trustedRevision !== revision) throw new Error('Environment revision is not trusted for execution')
    this.dependencies.environmentStore.readRevision(projectId, environmentId, revision)
  }

  private requireTask(taskId: string): Task {
    const task = this.dependencies.taskStore.read().tasks.find((candidate) => candidate.id === taskId)
    if (!task) throw new Error('Task not found')
    return task
  }

  private requireTaskWorktree(task: Task): ManagedWorktree {
    if (task.location !== 'worktree' || !task.worktreeId) throw new Error('Environment setup requires a task worktree')
    const worktree = this.dependencies.taskStore.read().managedWorktrees.find((candidate) => candidate.id === task.worktreeId && candidate.taskId === task.id)
    if (!worktree || worktree.lifecycle === 'removed') throw new Error('Task worktree unavailable')
    return worktree
  }

  private resolveCheckout(task: Task): string {
    if (task.location === 'worktree') return fs.realpathSync(this.requireTaskWorktree(task).path)
    const registry = this.dependencies.readProjects()
    const checkout = registry.checkouts.find((candidate) => candidate.id === task.checkoutId && candidate.projectId === task.projectId)
    if (!checkout?.available) throw new Error('Task checkout unavailable')
    return fs.realpathSync(checkout.canonicalPath)
  }

  private identity(task: Task): TerminalIdentity {
    return { projectId: task.projectId, taskId: task.id, checkoutId: task.checkoutId, worktreeId: task.worktreeId }
  }

  private replaceTask(task: Task): Promise<void> {
    return this.dependencies.taskStore.update((state) => ({
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id ? task : candidate),
    })).then(() => undefined)
  }

  private updateExecutionState(task: Task, worktree: ManagedWorktree, state: 'setup' | 'active' | 'failed'): Promise<void> {
    return this.dependencies.taskStore.update((store) => ({
      ...store,
      tasks: store.tasks.map((candidate) => candidate.id === task.id ? { ...candidate, state, updatedAt: Date.now() } : candidate),
      managedWorktrees: store.managedWorktrees.map((candidate) => candidate.id === worktree.id
        ? { ...candidate, lifecycle: state === 'failed' ? 'failed' : state, updatedAt: Date.now() }
        : candidate),
    })).then(() => undefined)
  }

  private async finishTask(task: Task, worktree: ManagedWorktree, job: EnvironmentJob): Promise<void> {
    if (job.status === 'succeeded') {
      await this.updateExecutionState(task, worktree, 'active')
      if (job.kind === 'test') {
        try {
          await this.dependencies.worktrees.remove(worktree.id)
        } catch {
          // A setup that left files or other protected state remains inspectable and counts toward the cap.
        }
      }
      return
    }
    await this.updateExecutionState(task, worktree, 'failed')
  }
}
