import fs from 'node:fs'
import path from 'node:path'
import { inspectGitCheckout, readProjectRegistry } from './repos'
import { TaskStore, type TaskStoreState } from './task-store'
import type { ProjectRegistry } from '../shared/projects'
import type { Task } from '../shared/tasks'

export interface ExecutionContext {
  projectId: string
  taskId: string
  checkoutId: string
  worktreeId: string | null
  cwd: string
  gitCommonDir: string
}

export interface ExecutionContextDependencies {
  readTasks?: () => TaskStoreState
  readProjects?: () => ProjectRegistry
}

function canonicalExistingDirectory(candidate: string, label: string): string {
  let canonical: string
  try {
    canonical = fs.realpathSync(candidate)
  } catch (error) {
    throw new Error(`${label} is unavailable`, { cause: error })
  }
  if (!fs.statSync(canonical).isDirectory()) throw new Error(`${label} is not a directory`)
  return canonical
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function resolveExecutionContext(
  taskId: string,
  dependencies: ExecutionContextDependencies = {},
): ExecutionContext {
  const tasks = (dependencies.readTasks ?? (() => new TaskStore().read()))()
  const registry = (dependencies.readProjects ?? readProjectRegistry)()
  const task = tasks.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error('Task not found')
  const project = registry.projects.find((candidate) => candidate.id === task.projectId)
  if (!project) throw new Error('Task project not found')

  let candidatePath: string
  let recordedCommonDir: string
  if (task.worktreeId) {
    const worktree = tasks.managedWorktrees.find((candidate) => candidate.id === task.worktreeId)
    if (!worktree || worktree.taskId !== task.id || worktree.checkoutId !== task.checkoutId) {
      throw new Error('Task worktree checkout not found')
    }
    if (worktree.projectId !== project.id) throw new Error('Task worktree belongs to another project')
    const recordedRoot = canonicalExistingDirectory(worktree.recordedRoot, 'Managed worktree root')
    candidatePath = canonicalExistingDirectory(worktree.path, 'Task worktree checkout')
    if (!isWithin(recordedRoot, candidatePath)) throw new Error('Task worktree escapes its managed root')
    recordedCommonDir = canonicalExistingDirectory(worktree.gitCommonDir, 'Task Git common directory')
  } else {
    const checkout = registry.checkouts.find((candidate) => candidate.id === task.checkoutId)
    if (!checkout || !checkout.available) throw new Error('Task checkout not found')
    if (checkout.projectId !== project.id) throw new Error('Task checkout belongs to another project')
    candidatePath = canonicalExistingDirectory(checkout.canonicalPath, 'Task checkout')
    recordedCommonDir = canonicalExistingDirectory(checkout.gitCommonDir, 'Task Git common directory')
  }

  const projectCommonDir = canonicalExistingDirectory(project.gitCommonDir, 'Project Git common directory')
  const inspected = inspectGitCheckout(candidatePath)
  if (inspected.gitCommonDir !== projectCommonDir || recordedCommonDir !== projectCommonDir) {
    throw new Error('Task checkout Git ownership mismatch')
  }

  return {
    projectId: project.id,
    taskId: task.id,
    checkoutId: task.checkoutId,
    worktreeId: task.worktreeId,
    cwd: inspected.canonicalPath,
    gitCommonDir: inspected.gitCommonDir,
  }
}

export function authorizeExecutionFile(context: ExecutionContext, filePath: string): string {
  if (!filePath || path.isAbsolute(filePath)) throw new Error('File path must be relative')
  const target = path.resolve(context.cwd, filePath)
  if (!isWithin(context.cwd, target)) throw new Error('File path escapes checkout')

  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('File parent is unavailable')
    existing = parent
  }
  const canonicalExisting = fs.realpathSync(existing)
  if (!isWithin(context.cwd, canonicalExisting)) throw new Error('File path escapes checkout through symlink')
  return target
}

export function executionIdentity(context: ExecutionContext): Pick<Task, 'projectId' | 'id' | 'checkoutId' | 'worktreeId'> {
  return {
    projectId: context.projectId,
    id: context.taskId,
    checkoutId: context.checkoutId,
    worktreeId: context.worktreeId,
  }
}

export function assertImmutableExecutionBinding(
  current: { taskId: string; checkoutId: string },
  requested: { taskId: string; checkoutId: string },
  surface: string,
): void {
  if (current.taskId !== requested.taskId || current.checkoutId !== requested.checkoutId) {
    throw new Error(`${surface} execution context is immutable`)
  }
}
