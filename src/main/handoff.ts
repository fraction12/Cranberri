import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { CodexRuntimeContext } from '../shared/codex'
import type { ProjectRegistry } from '../shared/projects'
import type { Task } from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import {
  applyLocalChanges,
  branchCheckoutPath,
  branchExists,
  captureLocalChanges,
  checkoutBranch,
  clearTransferredChanges,
  createBranch,
  detachCheckout,
  gitStatusPorcelain,
  resolveGitRef,
  type LocalChanges,
} from './git-worktrees'
import { hasRunningProcessesForPath } from './processRegistry'
import type { TaskStore } from './task-store'

export interface HandoffCodex {
  isThreadRunning(threadId: string): boolean
  hasActiveWorkers(threadId: string): boolean
  resumeThread(threadId: string, runtime: CodexRuntimeContext): Promise<unknown>
}

interface HandoffDependencies {
  hasRunningProcesses(path: string): Promise<boolean>
  now(): number
}

export interface HandoffRequest {
  taskId: string
  branch: string
  createBranch?: boolean
}

interface SerializedChanges {
  baseSha: string
  stagedPatch: string
  unstagedPatch: string
  untrackedFiles: Array<{ relativePath: string; contents: string; mode: number }>
}

const serializedChangesSchema = z.object({
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/i),
  stagedPatch: z.string(),
  unstagedPatch: z.string(),
  untrackedFiles: z.array(z.object({
    relativePath: z.string().min(1),
    contents: z.string(),
    mode: z.number().int().nonnegative(),
  }).strict()),
}).strict()

function serializeChanges(changes: LocalChanges): SerializedChanges {
  return {
    baseSha: changes.baseSha,
    stagedPatch: changes.stagedPatch.toString('base64'),
    unstagedPatch: changes.unstagedPatch.toString('base64'),
    untrackedFiles: changes.untrackedFiles.map((file) => ({
      ...file,
      contents: file.contents.toString('base64'),
    })),
  }
}

function writeBundle(root: string, taskId: string, changes: LocalChanges): string {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const bundlePath = path.join(root, `${taskId}-${crypto.randomUUID()}.json`)
  fs.writeFileSync(bundlePath, JSON.stringify(serializeChanges(changes)), { mode: 0o600 })
  return bundlePath
}

function readBundle(bundlePath: string): LocalChanges {
  const serialized = serializedChangesSchema.parse(JSON.parse(fs.readFileSync(bundlePath, 'utf8')))
  return {
    baseSha: serialized.baseSha,
    stagedPatch: Buffer.from(serialized.stagedPatch, 'base64'),
    unstagedPatch: Buffer.from(serialized.unstagedPatch, 'base64'),
    untrackedFiles: serialized.untrackedFiles.map((file) => ({
      ...file,
      contents: Buffer.from(file.contents, 'base64'),
    })),
  }
}

function ownedBundlePath(bundleRoot: string, taskId: string, bundlePath: string): string {
  const root = path.resolve(bundleRoot)
  const candidate = path.resolve(bundlePath)
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(candidate) !== root) {
    throw new Error('Transfer bundle is outside Cranberri storage')
  }
  if (!path.basename(candidate).startsWith(`${taskId}-`) || path.extname(candidate) !== '.json') {
    throw new Error('Transfer bundle identity does not match the task')
  }
  return candidate
}

function sameChanges(left: LocalChanges, right: LocalChanges): boolean {
  return left.baseSha === right.baseSha
    && left.stagedPatch.equals(right.stagedPatch)
    && left.unstagedPatch.equals(right.unstagedPatch)
    && left.untrackedFiles.length === right.untrackedFiles.length
    && left.untrackedFiles.every((file, index) => {
      const candidate = right.untrackedFiles[index]
      return candidate?.relativePath === file.relativePath
        && candidate.mode === file.mode
        && candidate.contents.equals(file.contents)
    })
}

function hasChanges(changes: LocalChanges): boolean {
  return changes.stagedPatch.length > 0
    || changes.unstagedPatch.length > 0
    || changes.untrackedFiles.length > 0
}

function activeChild(task: Task, rootTaskId: string): boolean {
  return task.parentTaskId === rootTaskId
    && !['archived', 'removed', 'failed'].includes(task.state)
}

export class HandoffCoordinator {
  private readonly dependencies: HandoffDependencies

  constructor(
    private readonly store: TaskStore,
    private readonly registry: ProjectRegistry,
    private readonly codex: HandoffCodex,
    private readonly bundleRoot: string,
    dependencies: Partial<HandoffDependencies> = {},
  ) {
    this.dependencies = {
      hasRunningProcesses: dependencies.hasRunningProcesses ?? hasRunningProcessesForPath,
      now: dependencies.now ?? Date.now,
    }
  }

  async toLocal(request: HandoffRequest): Promise<Task> {
    const context = await this.preflight(request.taskId, 'worktree')
    const { task, worktree, localPath } = context
    const head = await resolveGitRef(worktree.path, 'HEAD')
    await this.requireBranch(request, worktree.path, head)
    const owner = await branchCheckoutPath(worktree.path, request.branch)
    if (owner && fs.realpathSync(owner) !== fs.realpathSync(worktree.path)) {
      throw new Error('Branch is checked out in another worktree')
    }
    await this.acquireLease(task)
    let changes: LocalChanges | null = null
    let bundlePath: string | null = null
    let localApplied = false
    let worktreeCleared = false
    try {
      await this.begin(task, worktree, 'toLocal', request.branch)
      changes = await captureLocalChanges(worktree.path, head)
      bundlePath = writeBundle(this.bundleRoot, task.id, changes)
      await this.journal(task.id, 'captured', bundlePath)
      await detachCheckout(worktree.path, head)
      await this.journal(task.id, 'branchReleased', bundlePath)
      await checkoutBranch(localPath, request.branch)
      await applyLocalChanges(localPath, changes)
      localApplied = true
      await this.journal(task.id, 'applied', bundlePath)
      await this.verifyTransfer(worktree.path, localPath)
      await this.codex.resumeThread(task.threadId!, { cwd: localPath, taskId: task.id })
      await this.journal(task.id, 'resumed', bundlePath)
      await this.assertUnchanged(worktree.path, changes)
      await clearTransferredChanges(worktree.path, changes)
      worktreeCleared = true
      const updated = await this.commitBinding(task, worktree, 'local', request.branch)
      fs.rmSync(bundlePath)
      return updated
    } catch (error) {
      return this.failAndRollback({
        task, worktree, branch: request.branch, direction: 'toLocal', changes, bundlePath,
        destinationApplied: localApplied, sourceCleared: worktreeCleared, error,
      })
    }
  }

  async toWorktree(request: Omit<HandoffRequest, 'createBranch'>): Promise<Task> {
    const context = await this.preflight(request.taskId, 'local')
    const { task, worktree, localPath, project } = context
    if (worktree.branch !== request.branch) throw new Error('Task branch does not match its managed worktree')
    if (!project.pinnedLocalBranch) throw new Error('Local has no pinned return branch')
    const head = await resolveGitRef(localPath, 'HEAD')
    if (await resolveGitRef(localPath, `refs/heads/${request.branch}`) !== head) {
      throw new Error('Local is not on the task branch')
    }
    let changes: LocalChanges | null = null
    let bundlePath: string | null = null
    let worktreeApplied = false
    let localCleared = false
    try {
      await this.begin(task, worktree, 'toWorktree', request.branch)
      changes = await captureLocalChanges(localPath, head)
      bundlePath = writeBundle(this.bundleRoot, task.id, changes)
      await this.journal(task.id, 'captured', bundlePath)
      await detachCheckout(localPath, head)
      await checkoutBranch(worktree.path, request.branch)
      await applyLocalChanges(worktree.path, changes)
      worktreeApplied = true
      await this.journal(task.id, 'applied', bundlePath)
      await this.verifyTransfer(localPath, worktree.path)
      await this.assertUnchanged(localPath, changes)
      await clearTransferredChanges(localPath, changes)
      localCleared = true
      if (await gitStatusPorcelain(localPath)) throw new Error('Local task branch did not cleanly release')
      await checkoutBranch(localPath, project.pinnedLocalBranch)
      await this.journal(task.id, 'branchReleased', bundlePath)
      await this.codex.resumeThread(task.threadId!, { cwd: worktree.path, taskId: task.id })
      await this.journal(task.id, 'resumed', bundlePath)
      const updated = await this.commitBinding(task, worktree, 'worktree', request.branch)
      fs.rmSync(bundlePath)
      await this.releaseLease(task)
      return updated
    } catch (error) {
      return this.failAndRollback({ task, worktree, branch: request.branch, direction: 'toWorktree', changes, bundlePath, destinationApplied: worktreeApplied, sourceCleared: localCleared, error })
    }
  }

  async recoverInterrupted(taskId: string): Promise<Task> {
    const state = this.store.read()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task?.handoff || (task.state !== 'handingOff' && task.state !== 'needsAttention')) {
      throw new Error('Task has no interrupted handoff')
    }
    const worktree = state.managedWorktrees.find((item) => item.id === task.worktreeId)
    const project = this.registry.projects.find((item) => item.id === task.projectId)
    const local = project && this.registry.checkouts.find((item) => item.id === project.localCheckoutId)
    if (!worktree || !fs.existsSync(worktree.path)) throw new Error('Original managed worktree is unavailable')
    if (!project || !local?.available || !fs.existsSync(local.canonicalPath)) throw new Error('Local checkout is unavailable')
    if (!project.pinnedLocalBranch) throw new Error('Local has no pinned return branch')
    if (await this.dependencies.hasRunningProcesses(worktree.path) || await this.dependencies.hasRunningProcesses(local.canonicalPath)) {
      throw new Error('Task has running processes')
    }

    try {
      const bundlePath = task.handoff.bundlePath
        ? ownedBundlePath(this.bundleRoot, task.id, task.handoff.bundlePath)
        : null
      const bundle = bundlePath
        ? readBundle(bundlePath)
        : null
      if (task.handoff.phase !== 'preflight' && !bundle) {
        throw new Error('The retained transfer bundle is unavailable')
      }
      if (task.handoff.direction === 'toLocal') {
        await this.rollbackToWorktree(task, worktree, local.canonicalPath, project.pinnedLocalBranch, bundle)
      } else {
        await this.rollbackToLocal(task, worktree, local.canonicalPath, bundle)
      }
      const updated = await this.restoreInterruptedBinding(task, worktree)
      if (bundlePath) {
        try {
          fs.rmSync(bundlePath, { force: true })
        } catch (error) {
          console.warn(`Recovered handoff ${task.id}, but its transfer bundle could not be removed`, error)
        }
      }
      return updated
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Handoff recovery failed'
      await this.journal(task.id, 'needsAttention', task.handoff.bundlePath, message)
      await this.store.update((current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id ? { ...item, state: 'needsAttention' as const } : item),
        managedWorktrees: current.managedWorktrees.map((item) => item.id === worktree.id ? {
          ...item, lifecycle: 'needsAttention' as const, cleanupReason: message, updatedAt: this.dependencies.now(),
        } : item),
      }))
      throw error
    }
  }

  private async preflight(taskId: string, location: Task['location']): Promise<{ task: Task; worktree: ManagedWorktree; localPath: string; project: ProjectRegistry['projects'][number] }> {
    const state = this.store.read()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task || task.role !== 'root' || task.location !== location) throw new Error(`Task is not an idle ${location} root task`)
    if (!task.threadId) throw new Error('Task has no Codex thread')
    if (task.state !== (location === 'local' ? 'local' : 'active')) throw new Error('Task is not idle')
    if (this.codex.isThreadRunning(task.threadId)) throw new Error('Task is still running')
    if (this.codex.hasActiveWorkers(task.threadId) || state.tasks.some((item) => activeChild(item, task.id))) {
      throw new Error('Task has active workers')
    }
    const worktree = state.managedWorktrees.find((item) => item.id === task.worktreeId)
    if (!worktree || !fs.existsSync(worktree.path)) throw new Error('Original managed worktree is unavailable')
    const project = this.registry.projects.find((item) => item.id === task.projectId)
    const checkout = project && this.registry.checkouts.find((item) => item.id === project.localCheckoutId)
    if (!project || !checkout?.available || !fs.existsSync(checkout.canonicalPath)) throw new Error('Local checkout is unavailable')
    if (await this.dependencies.hasRunningProcesses(worktree.path) || await this.dependencies.hasRunningProcesses(checkout.canonicalPath)) {
      throw new Error('Task has running processes')
    }
    const lease = state.localLeaseByProjectId[task.projectId]
    if (lease && lease !== task.id) throw new Error('Local is in use by another task')
    if (location === 'worktree' && await gitStatusPorcelain(checkout.canonicalPath)) throw new Error('Local must be clean before handoff')
    return { task, worktree, localPath: checkout.canonicalPath, project }
  }

  private async requireBranch(request: HandoffRequest, checkoutPath: string, head: string): Promise<void> {
    const exists = await branchExists(checkoutPath, request.branch)
    if (request.createBranch) {
      if (exists) throw new Error('Branch already exists; select it explicitly')
      await createBranch(checkoutPath, request.branch, head)
      return
    }
    if (!exists) throw new Error('A named branch must be selected or explicitly created')
    if (await resolveGitRef(checkoutPath, `refs/heads/${request.branch}`) !== head) {
      throw new Error('Selected branch does not point at the task HEAD')
    }
  }

  private async acquireLease(task: Task): Promise<void> {
    await this.store.update((state) => {
      const holder = state.localLeaseByProjectId[task.projectId]
      if (holder && holder !== task.id) throw new Error('Local is in use by another task')
      return { ...state, localLeaseByProjectId: { ...state.localLeaseByProjectId, [task.projectId]: task.id } }
    })
  }

  private async releaseLease(task: Task): Promise<void> {
    await this.store.update((state) => ({
      ...state,
      localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === task.id
        ? { ...state.localLeaseByProjectId, [task.projectId]: null }
        : state.localLeaseByProjectId,
    }))
  }

  private begin(task: Task, worktree: ManagedWorktree, direction: 'toLocal' | 'toWorktree', branch: string): Promise<unknown> {
    const now = this.dependencies.now()
    return this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((item) => item.id === task.id ? {
        ...item, state: 'handingOff' as const, updatedAt: now,
        handoff: { direction, phase: 'preflight' as const, branch, bundlePath: null, startedAt: now, error: null },
      } : item),
      managedWorktrees: state.managedWorktrees.map((item) => item.id === worktree.id ? { ...item, updatedAt: now } : item),
    }))
  }

  private journal(taskId: string, phase: NonNullable<Task['handoff']>['phase'], bundlePath: string | null, error: string | null = null): Promise<unknown> {
    return this.store.update((state) => ({ ...state, tasks: state.tasks.map((task) => task.id === taskId && task.handoff ? {
      ...task, handoff: { ...task.handoff, phase, bundlePath, error }, updatedAt: this.dependencies.now(),
    } : task) }))
  }

  private async verifyTransfer(sourcePath: string, destinationPath: string): Promise<void> {
    const [sourceHead, destinationHead, sourceStatus, destinationStatus] = await Promise.all([
      resolveGitRef(sourcePath, 'HEAD'), resolveGitRef(destinationPath, 'HEAD'),
      gitStatusPorcelain(sourcePath), gitStatusPorcelain(destinationPath),
    ])
    if (sourceHead !== destinationHead || sourceStatus !== destinationStatus) {
      throw new Error('Transferred checkout did not verify against its source')
    }
  }

  private async assertUnchanged(checkoutPath: string, expected: LocalChanges): Promise<void> {
    const current = await captureLocalChanges(checkoutPath, expected.baseSha)
    if (!sameChanges(current, expected)) throw new Error('Checkout changed during handoff; duplicate data was preserved')
  }

  private async reconcileChanges(checkoutPath: string, expected: LocalChanges, destination: boolean): Promise<void> {
    const head = await resolveGitRef(checkoutPath, 'HEAD')
    if (head !== expected.baseSha) {
      if (await gitStatusPorcelain(checkoutPath)) throw new Error('Checkout changed during handoff recovery')
      return
    }
    const current = await captureLocalChanges(checkoutPath, expected.baseSha)
    if (sameChanges(current, expected)) {
      if (destination && hasChanges(current)) await clearTransferredChanges(checkoutPath, current)
      return
    }
    if (hasChanges(current)) throw new Error('Checkout changed during handoff recovery')
    if (!destination && hasChanges(expected)) await applyLocalChanges(checkoutPath, expected)
  }

  private async rollbackToWorktree(
    task: Task,
    worktree: ManagedWorktree,
    localPath: string,
    pinnedBranch: string,
    changes: LocalChanges | null,
  ): Promise<void> {
    if (changes) await this.reconcileChanges(localPath, changes, true)
    await checkoutBranch(localPath, pinnedBranch)
    await checkoutBranch(worktree.path, task.handoff!.branch)
    if (changes) await this.reconcileChanges(worktree.path, changes, false)
  }

  private async rollbackToLocal(
    task: Task,
    worktree: ManagedWorktree,
    localPath: string,
    changes: LocalChanges | null,
  ): Promise<void> {
    if (changes) await this.reconcileChanges(worktree.path, changes, true)
    await detachCheckout(worktree.path, await resolveGitRef(worktree.path, 'HEAD'))
    await checkoutBranch(localPath, task.handoff!.branch)
    if (changes) await this.reconcileChanges(localPath, changes, false)
  }

  private async restoreInterruptedBinding(task: Task, worktree: ManagedWorktree): Promise<Task> {
    const location = task.handoff!.direction === 'toLocal' ? 'worktree' : 'local'
    let updated!: Task
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((item) => {
        if (item.id !== task.id) return item
        updated = {
          ...item,
          checkoutId: location === 'local'
            ? this.registry.projects.find((project) => project.id === task.projectId)!.localCheckoutId
            : worktree.checkoutId,
          location,
          state: location === 'local' ? 'local' : 'active',
          handoff: null,
          updatedAt: this.dependencies.now(),
        }
        return updated
      }),
      managedWorktrees: state.managedWorktrees.map((item) => item.id === worktree.id ? {
        ...item,
        lifecycle: location === 'local' ? 'handedOff' as const : 'active' as const,
        cleanupReason: null,
        updatedAt: this.dependencies.now(),
      } : item),
      localLeaseByProjectId: {
        ...state.localLeaseByProjectId,
        [task.projectId]: location === 'local' ? task.id : null,
      },
    }))
    return updated
  }

  private async commitBinding(task: Task, worktree: ManagedWorktree, location: Task['location'], branch: string): Promise<Task> {
    let updated!: Task
    await this.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((item) => {
        if (item.id !== task.id) return item
        updated = { ...item, checkoutId: location === 'local'
          ? this.registry.projects.find((project) => project.id === task.projectId)!.localCheckoutId
          : worktree.checkoutId, location, state: location === 'local' ? 'local' : 'active', handoff: null, updatedAt: this.dependencies.now() }
        return updated
      }),
      managedWorktrees: state.managedWorktrees.map((item) => item.id === worktree.id ? {
        ...item, branch, lifecycle: location === 'local' ? 'handedOff' : 'active', updatedAt: this.dependencies.now(),
      } : item),
    }))
    return updated
  }

  private async failAndRollback(input: { task: Task; worktree: ManagedWorktree; branch: string; direction: 'toLocal' | 'toWorktree'; changes: LocalChanges | null; bundlePath: string | null; destinationApplied: boolean; sourceCleared?: boolean; error: unknown }): Promise<never> {
    const message = input.error instanceof Error ? input.error.message : 'Handoff failed'
    try {
      const project = this.registry.projects.find((item) => item.id === input.task.projectId)!
      const localPath = this.registry.checkouts.find((item) => item.id === project.localCheckoutId)!.canonicalPath
      if (input.direction === 'toLocal') {
        if (input.destinationApplied && input.changes) {
          await this.assertUnchanged(localPath, input.changes)
          await clearTransferredChanges(localPath, input.changes)
        }
        if (project.pinnedLocalBranch) await checkoutBranch(localPath, project.pinnedLocalBranch)
        await checkoutBranch(input.worktree.path, input.branch)
        if (input.sourceCleared && input.changes) await applyLocalChanges(input.worktree.path, input.changes)
      } else {
        if (input.destinationApplied && input.changes) {
          await this.assertUnchanged(input.worktree.path, input.changes)
          await clearTransferredChanges(input.worktree.path, input.changes)
        }
        await detachCheckout(input.worktree.path, await resolveGitRef(input.worktree.path, 'HEAD'))
        await checkoutBranch(localPath, input.branch)
        if (input.sourceCleared && input.changes) await applyLocalChanges(localPath, input.changes)
      }
      await this.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((task) => task.id === input.task.id ? { ...task, state: input.task.state, handoff: null, updatedAt: this.dependencies.now() } : task),
        managedWorktrees: state.managedWorktrees.map((worktree) => worktree.id === input.worktree.id ? { ...worktree, lifecycle: input.worktree.lifecycle, updatedAt: this.dependencies.now() } : worktree),
      }))
      if (input.direction === 'toLocal') await this.releaseLease(input.task)
      if (input.bundlePath) fs.rmSync(input.bundlePath, { force: true })
    } catch (rollbackError) {
      await this.journal(input.task.id, 'needsAttention', input.bundlePath, `${message}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : 'unknown error'}`)
      await this.store.update((state) => ({ ...state, tasks: state.tasks.map((task) => task.id === input.task.id ? { ...task, state: 'needsAttention' as const } : task), managedWorktrees: state.managedWorktrees.map((worktree) => worktree.id === input.worktree.id ? { ...worktree, lifecycle: 'needsAttention' as const, cleanupReason: message } : worktree) }))
    }
    throw input.error
  }
}
