import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectRegistry } from '../shared/projects'
import type { Task } from '../shared/tasks'
import type { TaskStoreState } from './task-store'
import { assertImmutableExecutionBinding, authorizeExecutionFile, resolveExecutionContext } from './execution-context'

const roots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { registry: ProjectRegistry; tasks: TaskStoreState; local: string; worktreeA: string; worktreeB: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-execution-'))
  roots.push(root)
  const local = path.join(root, 'local')
  const managedRoot = path.join(root, 'managed')
  fs.mkdirSync(local)
  fs.mkdirSync(managedRoot)
  git(local, ['init'])
  git(local, ['config', 'user.email', 'test@example.com'])
  git(local, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(local, 'README.md'), 'base\n')
  git(local, ['add', '.'])
  git(local, ['commit', '-m', 'base'])
  const worktreeA = path.join(managedRoot, 'a')
  const worktreeB = path.join(managedRoot, 'b')
  git(local, ['worktree', 'add', '--detach', worktreeA, 'HEAD'])
  git(local, ['worktree', 'add', '--detach', worktreeB, 'HEAD'])
  const commonDir = fs.realpathSync(path.resolve(local, git(local, ['rev-parse', '--path-format=absolute', '--git-common-dir'])))
  const now = Date.now()
  const makeTask = (id: string, checkoutId: string, worktreeId: string): Task => ({
    id, projectId: 'project', threadId: null, checkoutId, worktreeId, role: 'root', location: 'worktree',
    state: 'active', baseRef: 'HEAD', baseSha: git(local, ['rev-parse', 'HEAD']), environmentId: null,
    environmentRevision: null, pendingFirstTurn: null, createdAt: now, updatedAt: now,
  })
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{ id: 'project', name: 'Project', gitCommonDir: commonDir, localCheckoutId: 'local', pinnedLocalBranch: null, defaultEnvironmentId: null, controlTaskId: 'control', localLeaseTaskId: null }],
    checkouts: [{ id: 'local', projectId: 'project', kind: 'local', canonicalPath: local, gitCommonDir: commonDir, ownership: 'user', available: true }],
    activeProjectId: 'project',
  }
  const tasks: TaskStoreState = {
    version: 1,
    tasks: [makeTask('task-a', 'checkout-a', 'worktree-a'), makeTask('task-b', 'checkout-b', 'worktree-b')],
    managedWorktrees: [
      { id: 'worktree-a', projectId: 'project', checkoutId: 'checkout-a', taskId: 'task-a', path: worktreeA, recordedRoot: managedRoot, gitCommonDir: commonDir, manifestPath: path.join(root, 'a.json'), baseRef: 'HEAD', baseSha: git(local, ['rev-parse', 'HEAD']), branch: null, headSha: null, archiveHeadSha: null, privateRef: null, lifecycle: 'active', cleanupReason: null, createdAt: now, updatedAt: now, archivedAt: null },
      { id: 'worktree-b', projectId: 'project', checkoutId: 'checkout-b', taskId: 'task-b', path: worktreeB, recordedRoot: managedRoot, gitCommonDir: commonDir, manifestPath: path.join(root, 'b.json'), baseRef: 'HEAD', baseSha: git(local, ['rev-parse', 'HEAD']), branch: null, headSha: null, archiveHeadSha: null, privateRef: null, lifecycle: 'active', cleanupReason: null, createdAt: now, updatedAt: now, archivedAt: null },
    ],
    localLeaseByProjectId: {}, interruptedOperations: [],
  }
  return { registry, tasks, local, worktreeA, worktreeB }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('execution context routing', () => {
  it('resolves two interleaved worktree tasks without crossing checkouts', () => {
    const value = fixture()
    const dependencies = { readTasks: () => value.tasks, readProjects: () => value.registry }
    expect(resolveExecutionContext('task-a', dependencies).cwd).toBe(fs.realpathSync(value.worktreeA))
    expect(resolveExecutionContext('task-b', dependencies).cwd).toBe(fs.realpathSync(value.worktreeB))
    expect(resolveExecutionContext('task-a', dependencies).cwd).toBe(fs.realpathSync(value.worktreeA))
  })

  it('fails closed for a missing checkout record', () => {
    const value = fixture()
    value.tasks.managedWorktrees = []
    expect(() => resolveExecutionContext('task-a', { readTasks: () => value.tasks, readProjects: () => value.registry })).toThrow('Task worktree checkout not found')
  })

  it('rejects file targets whose existing parent escapes through a symlink', () => {
    const value = fixture()
    const context = resolveExecutionContext('task-a', { readTasks: () => value.tasks, readProjects: () => value.registry })
    const outside = path.join(path.dirname(value.local), 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(context.cwd, 'escape'))
    expect(() => authorizeExecutionFile(context, 'escape/new.txt')).toThrow('escapes checkout through symlink')
  })

  it('keeps terminal and browser bindings immutable', () => {
    expect(() => assertImmutableExecutionBinding(
      { taskId: 'task-a', checkoutId: 'checkout-a' },
      { taskId: 'task-b', checkoutId: 'checkout-b' },
      'Terminal',
    )).toThrow('Terminal execution context is immutable')
  })
})
