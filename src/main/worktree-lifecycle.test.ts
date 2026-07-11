import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { WorktreeLifecycle } from './worktree-lifecycle'

const roots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture(): { root: string; repo: string; managedRoot: string; store: TaskStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri lifecycle '))
  roots.push(root)
  const repo = path.join(root, 'repo')
  const managedRoot = path.join(root, 'managed')
  fs.mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Cranberri Test')
  git(repo, 'config', 'user.email', 'test@cranberri.local')
  fs.writeFileSync(path.join(repo, 'file.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  return { root, repo, managedRoot, store: new TaskStore(path.join(root, 'tasks.json')) }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('managed worktree lifecycle', () => {
  it('serializes capacity checks and creates only up to the configured cap', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    const request = (taskId: string) => lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId, taskName: taskId,
      localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 1,
    })

    const results = await Promise.allSettled([request('task-a'), request('task-b')])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(store.read().managedWorktrees).toHaveLength(1)
  })

  it('reclaims the oldest safe archived worktree when at capacity', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    const archived = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'old-task',
      taskName: 'Old task', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 1,
    })
    await store.update((state) => ({
      ...state,
      managedWorktrees: state.managedWorktrees.map((item) => item.id === archived.id
        ? { ...item, lifecycle: 'archived' as const, archivedAt: Date.now() }
        : item),
    }))

    const replacement = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'new-task',
      taskName: 'New task', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 1,
    })

    const records = store.read().managedWorktrees
    expect(records.find((item) => item.id === archived.id)?.lifecycle).toBe('removed')
    expect(replacement.lifecycle).toBe('active')
    expect(fs.existsSync(replacement.path)).toBe(true)
  })

  it('records canonical ownership and a sidecar outside the checkout', async () => {
    const { repo, managedRoot, store } = fixture()
    const record = await new WorktreeLifecycle(store).create({
      projectId: 'project-12345678', projectName: 'Hello World', taskId: 'task-12345678',
      taskName: 'Fix spaces', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })

    expect(record.gitCommonDir).toBe(fs.realpathSync(path.join(repo, '.git')))
    expect(record.path.startsWith(fs.realpathSync(managedRoot) + path.sep)).toBe(true)
    expect(record.manifestPath.startsWith(path.join(fs.realpathSync(managedRoot), '.cranberri'))).toBe(true)
    expect(fs.existsSync(record.manifestPath)).toBe(true)
    expect(fs.existsSync(path.join(record.path, '.cranberri-worktree.json'))).toBe(false)
  })

  it('anchors a private task ref and removes only a verified clean owned worktree', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    const record = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-12345678',
      taskName: 'Task', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })

    const archivedAt = Date.now()
    const archived = await lifecycle.archiveAndRemove(record.id, {
      retentionDays: 7,
      now: archivedAt,
    })
    expect(archived.lifecycle).toBe('archived')
    expect(fs.existsSync(record.path)).toBe(true)

    const removed = await lifecycle.archiveAndRemove(record.id, {
      retentionDays: 7,
      now: archivedAt + 8 * 86_400_000,
    })

    expect(removed.lifecycle).toBe('removed')
    expect(removed.privateRef).toBe('refs/cranberri/tasks/task-12345678')
    expect(git(repo, 'rev-parse', removed.privateRef!)).toBe(record.baseSha)
    expect(fs.existsSync(record.path)).toBe(false)
  })

  it('fails closed for dirty, process-owning, and ownership-mismatched worktrees', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, { hasRunningProcesses: async () => false })
    const record = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-12345678',
      taskName: 'Task', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(record.path, 'dirty.txt'), 'dirty')
    await expect(lifecycle.remove(record.id)).rejects.toThrow('dirty')

    fs.rmSync(path.join(record.path, 'dirty.txt'))
    const busy = new WorktreeLifecycle(store, { hasRunningProcesses: async () => true })
    await expect(busy.remove(record.id)).rejects.toThrow('running processes')

    const manifest = JSON.parse(fs.readFileSync(record.manifestPath, 'utf8')) as Record<string, unknown>
    fs.writeFileSync(record.manifestPath, JSON.stringify({ ...manifest, worktreeId: 'someone-else' }))
    await expect(lifecycle.remove(record.id)).rejects.toThrow('ownership')
  })

  it('protects unique detached commits and unpushed branches', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    const unique = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'unique-task',
      taskName: 'Unique', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(unique.path, 'file.txt'), 'unique\n')
    git(unique.path, 'add', '.')
    git(unique.path, 'commit', '-m', 'unique detached commit')
    await expect(lifecycle.remove(unique.id)).rejects.toThrow('unique detached commit')

    const branchRecord = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'branch-task',
      taskName: 'Branch', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    git(branchRecord.path, 'switch', '-c', 'feature/local-only')
    await expect(lifecycle.remove(branchRecord.id)).rejects.toThrow('unpushed branch')
  })

  it('never adopts or deletes an external worktree', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const external = path.join(root, 'external')
    git(repo, 'worktree', 'add', '--detach', external, 'HEAD')
    const lifecycle = new WorktreeLifecycle(store)

    await expect(lifecycle.removeByPath(external)).rejects.toThrow('not managed')
    expect(fs.existsSync(external)).toBe(true)
    expect(fs.existsSync(managedRoot)).toBe(false)
  })
})
