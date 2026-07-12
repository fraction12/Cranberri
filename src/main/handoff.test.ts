import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectRegistry } from '../shared/projects'
import { HandoffCoordinator, type HandoffCodex } from './handoff'
import { TaskStore } from './task-store'
import { TaskCoordinator } from './tasks'
import { WorktreeLifecycle } from './worktree-lifecycle'

const roots: string[] = []
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { root: string; repo: string; managedRoot: string; store: TaskStore; lifecycle: WorktreeLifecycle; registry: ProjectRegistry } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-handoff-'))
  roots.push(root)
  const repo = path.join(root, 'repo')
  const managedRoot = path.join(root, 'managed')
  fs.mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Cranberri Test')
  git(repo, 'config', 'user.email', 'test@cranberri.local')
  fs.writeFileSync(path.join(repo, 'file.txt'), 'one\n')
  fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2]))
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  const store = new TaskStore(path.join(root, 'tasks.json'))
  const registry: ProjectRegistry = {
    version: 1, activeProjectId: 'project',
    projects: [{ id: 'project', name: 'Project', gitCommonDir: fs.realpathSync(path.join(repo, '.git')), localCheckoutId: 'local', pinnedLocalBranch: 'main', defaultEnvironmentId: null, controlTaskId: 'control', localLeaseTaskId: null }],
    checkouts: [{ id: 'local', projectId: 'project', kind: 'local', canonicalPath: repo, gitCommonDir: fs.realpathSync(path.join(repo, '.git')), ownership: 'user', available: true }],
  }
  return { root, repo, managedRoot, store, lifecycle: new WorktreeLifecycle(store, { hasRunningProcesses: async () => false, trashResidual: async () => undefined }), registry }
}

async function activeTask(f: ReturnType<typeof fixture>, environmentRevision: string | null = null): Promise<{ taskId: string; worktreePath: string }> {
  const worktree = await f.lifecycle.create({ projectId: 'project', projectName: 'Project', taskId: 'task', taskName: 'Task', localCheckoutPath: f.repo, managedRoot: f.managedRoot, baseRef: 'main', cap: 15 })
  await f.store.update((state) => ({
    ...state,
    tasks: [{ id: 'task', projectId: 'project', threadId: 'thread', checkoutId: worktree.checkoutId, worktreeId: worktree.id, role: 'root', location: 'worktree', state: 'active', baseRef: 'refs/heads/main', baseSha: worktree.baseSha, environmentId: environmentRevision ? 'env' : null, environmentRevision, pendingFirstTurn: null, createdAt: 1, updatedAt: 1 }],
    managedWorktrees: state.managedWorktrees.map((item) => ({ ...item, environmentRevision })),
  }))
  return { taskId: 'task', worktreePath: worktree.path }
}

function codex(overrides: Partial<HandoffCodex> = {}): HandoffCodex {
  return { isThreadRunning: () => false, hasActiveWorkers: () => false, resumeThread: async () => ({}), ...overrides }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('journaled handoff', () => {
  it('round trips staged, unstaged, binary, and untracked changes through Local', async () => {
    const f = fixture()
    const { worktreePath } = await activeTask(f)
    fs.writeFileSync(path.join(worktreePath, 'file.txt'), 'staged\n')
    git(worktreePath, 'add', 'file.txt')
    fs.appendFileSync(path.join(worktreePath, 'file.txt'), 'unstaged\n')
    fs.writeFileSync(path.join(worktreePath, 'binary.bin'), Buffer.from([9, 8, 7, 0]))
    fs.writeFileSync(path.join(worktreePath, 'new.txt'), 'untracked\n')
    const coordinator = new HandoffCoordinator(f.store, f.registry, codex(), path.join(f.root, 'bundles'), { hasRunningProcesses: async () => false })

    const local = await coordinator.toLocal({ taskId: 'task', branch: 'feature', createBranch: true })
    expect(local.location).toBe('local')
    expect(git(f.repo, 'branch', '--show-current')).toBe('feature')
    expect(fs.readFileSync(path.join(f.repo, 'binary.bin'))).toEqual(Buffer.from([9, 8, 7, 0]))
    expect(fs.existsSync(path.join(worktreePath, 'new.txt'))).toBe(false)

    const returned = await coordinator.toWorktree({ taskId: 'task', branch: 'feature' })
    expect(returned.location).toBe('worktree')
    expect(git(f.repo, 'branch', '--show-current')).toBe('main')
    expect(git(worktreePath, 'branch', '--show-current')).toBe('feature')
    expect(fs.readFileSync(path.join(worktreePath, 'new.txt'), 'utf8')).toBe('untracked\n')
    expect(f.store.read().localLeaseByProjectId.project).toBeNull()
  })

  it('preserves the pinned branch tip when the task branch advances in Local', async () => {
    const f = fixture()
    const mainTip = git(f.repo, 'rev-parse', 'main')
    const { worktreePath } = await activeTask(f)
    const coordinator = new HandoffCoordinator(f.store, f.registry, codex(), path.join(f.root, 'bundles'), { hasRunningProcesses: async () => false })

    await coordinator.toLocal({ taskId: 'task', branch: 'feature', createBranch: true })
    fs.writeFileSync(path.join(f.repo, 'committed.txt'), 'task commit\n')
    git(f.repo, 'add', 'committed.txt')
    git(f.repo, 'commit', '-m', 'task commit')
    const taskTip = git(f.repo, 'rev-parse', 'feature')
    fs.writeFileSync(path.join(f.repo, 'pending.txt'), 'pending\n')

    await coordinator.toWorktree({ taskId: 'task', branch: 'feature' })

    expect(git(f.repo, 'rev-parse', 'main')).toBe(mainTip)
    expect(git(f.repo, 'branch', '--show-current')).toBe('main')
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(taskTip)
    expect(fs.readFileSync(path.join(worktreePath, 'pending.txt'), 'utf8')).toBe('pending\n')
  })

  it('blocks dirty Local and active workers before mutation', async () => {
    const f = fixture()
    await activeTask(f)
    fs.writeFileSync(path.join(f.repo, 'local.txt'), 'dirty')
    const coordinator = new HandoffCoordinator(f.store, f.registry, codex(), path.join(f.root, 'bundles'), { hasRunningProcesses: async () => false })
    await expect(coordinator.toLocal({ taskId: 'task', branch: 'feature', createBranch: true })).rejects.toThrow('Local must be clean')
    fs.rmSync(path.join(f.repo, 'local.txt'))
    const workerBlocked = new HandoffCoordinator(f.store, f.registry, codex({ hasActiveWorkers: () => true }), path.join(f.root, 'bundles'), { hasRunningProcesses: async () => false })
    await expect(workerBlocked.toLocal({ taskId: 'task', branch: 'feature', createBranch: true })).rejects.toThrow('active workers')
  })

  it('rolls back branch ownership and preserves source changes when resume fails', async () => {
    const f = fixture()
    const { worktreePath } = await activeTask(f)
    fs.writeFileSync(path.join(worktreePath, 'new.txt'), 'keep me')
    const coordinator = new HandoffCoordinator(f.store, f.registry, codex({ resumeThread: async () => { throw new Error('resume failed') } }), path.join(f.root, 'bundles'), { hasRunningProcesses: async () => false })
    await expect(coordinator.toLocal({ taskId: 'task', branch: 'feature', createBranch: true })).rejects.toThrow('resume failed')
    expect(f.store.read().tasks[0].location).toBe('worktree')
    expect(f.store.read().tasks[0].state).toBe('active')
    expect(git(f.repo, 'branch', '--show-current')).toBe('main')
    expect(git(worktreePath, 'branch', '--show-current')).toBe('feature')
    expect(fs.readFileSync(path.join(worktreePath, 'new.txt'), 'utf8')).toBe('keep me')
  })

  it('keeps the journal until binding commits and restores a cleared source on commit failure', async () => {
    const f = fixture()
    const { worktreePath } = await activeTask(f)
    fs.writeFileSync(path.join(worktreePath, 'new.txt'), 'keep me')
    const update = f.store.update.bind(f.store)
    let bindingFailed = false
    f.store.update = async (updater) => {
      if (!bindingFailed && f.store.read().tasks[0]?.handoff?.phase === 'resumed') {
        bindingFailed = true
        throw new Error('binding persist failed')
      }
      return update(updater)
    }
    const coordinator = new HandoffCoordinator(
      f.store, f.registry, codex(), path.join(f.root, 'bundles'),
      { hasRunningProcesses: async () => false },
    )

    await expect(coordinator.toLocal({ taskId: 'task', branch: 'feature', createBranch: true }))
      .rejects.toThrow('binding persist failed')

    expect(f.store.read().tasks[0]).toMatchObject({ location: 'worktree', state: 'active', handoff: null })
    expect(git(f.repo, 'branch', '--show-current')).toBe('main')
    expect(git(worktreePath, 'branch', '--show-current')).toBe('feature')
    expect(fs.readFileSync(path.join(worktreePath, 'new.txt'), 'utf8')).toBe('keep me')
    expect(f.store.read().localLeaseByProjectId.project).toBeNull()
  })

  it('restores a safely removed archive from its private ref and exact environment revision', async () => {
    const f = fixture()
    await activeTask(f, 'revision-1')
    const tasks = new TaskCoordinator(f.store, f.lifecycle, { archiveThread: async () => undefined, unarchiveThread: async () => ({}) })
    await tasks.archive('task')
    const record = f.store.read().managedWorktrees[0]
    await f.lifecycle.archiveAndRemove(record.id, { retentionDays: 0, now: Date.now() + 1 })
    expect(fs.existsSync(record.path)).toBe(false)
    const revisions: string[] = []
    const restored = await tasks.unarchive('task', f.repo, async (_worktree, revision) => { revisions.push(revision) })
    expect(restored.state).toBe('active')
    expect(fs.existsSync(record.path)).toBe(true)
    expect(revisions).toEqual(['revision-1'])
    expect(git(f.repo, 'rev-parse', 'refs/cranberri/tasks/task')).toBe(record.baseSha)
  })

  it('never removes an external worktree during managed archive cleanup', async () => {
    const f = fixture()
    await activeTask(f)
    const external = path.join(f.root, 'external')
    git(f.repo, 'worktree', 'add', '--detach', external, 'HEAD')
    const record = f.store.read().managedWorktrees[0]
    await f.lifecycle.archiveAndRemove(record.id, { retentionDays: 0, now: Date.now() + 1 })
    expect(fs.existsSync(external)).toBe(true)
    expect(git(external, 'rev-parse', '--is-inside-work-tree')).toBe('true')
  })
})
