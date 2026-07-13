import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorktreeSnapshotDescriptor } from '../shared/worktree-snapshots'
import { captureLocalChanges, localChangesEqual } from './git-worktrees'
import { TaskStore } from './task-store'
import { WorktreeLifecycle } from './worktree-lifecycle'
import { WorktreeSnapshotStore } from './worktree-snapshot-store'

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

async function finishOperation(store: TaskStore, operationId: string): Promise<void> {
  await store.update((state) => ({
    ...state,
    lifecycleOperations: state.lifecycleOperations.map((operation) => operation.id === operationId
      ? { ...operation, status: 'completed' as const, phase: 'completed' as const, updatedAt: Date.now() }
      : operation),
  }))
}

async function recordRemovedSnapshot(
  store: TaskStore,
  worktreeId: string,
  descriptor: WorktreeSnapshotDescriptor,
  headSha: string,
  privateRef: string,
): Promise<void> {
  await store.update((state) => ({
    ...state,
    managedWorktrees: state.managedWorktrees.map((worktree) => worktree.id === worktreeId
      ? {
          ...worktree,
          lifecycle: 'removed' as const,
          archiveHeadSha: headSha,
          headSha,
          privateRef,
          snapshot: descriptor,
        }
      : worktree),
  }))
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

  it('reclaims enough archived worktrees when the configured cap is lowered', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    for (const taskId of ['old-a', 'old-b', 'old-c']) {
      const record = await lifecycle.create({
        projectId: 'project-12345678', projectName: 'Project', taskId,
        taskName: taskId, localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 3,
      })
      await lifecycle.archive(record.id)
    }

    const replacement = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'replacement',
      taskName: 'Replacement', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 1,
    })

    expect(store.read().managedWorktrees.filter((item) => item.lifecycle !== 'removed')).toEqual([replacement])
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

  it('records provisioning intent before filesystem ownership can fail', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, {
      writeOwnershipManifest: () => { throw new Error('manifest write failed') },
    })
    const request = {
      projectId: 'project-12345678', projectName: 'Project', taskId: 'interrupted-task',
      taskName: 'Interrupted', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    }

    await expect(lifecycle.create(request)).rejects.toThrow('manifest write failed')

    const recorded = store.read().managedWorktrees[0]
    expect(recorded).toMatchObject({ taskId: 'interrupted-task', lifecycle: 'needsAttention' })
    expect(fs.existsSync(recorded.path)).toBe(true)
    expect(store.read().interruptedOperations).toContainEqual(expect.objectContaining({
      kind: 'create', worktreeId: recorded.id, path: recorded.path,
    }))
    await expect(lifecycle.create(request)).rejects.toThrow('already has a recorded managed worktree')
    expect(store.read().managedWorktrees).toHaveLength(1)
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

  it('sweeps expired archives while preserving worktrees inside retention', async () => {
    const { repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store)
    const expired = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'expired',
      taskName: 'Expired', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 2,
    })
    const retained = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'retained',
      taskName: 'Retained', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 2,
    })
    const now = Date.now()
    await lifecycle.archive(expired.id, now - 8 * 86_400_000)
    await lifecycle.archive(retained.id, now - 6 * 86_400_000)

    const removed = await lifecycle.sweepRetention({ retentionDays: 7, now })

    expect(removed.map((item) => item.id)).toEqual([expired.id])
    expect(store.read().managedWorktrees.find((item) => item.id === expired.id)?.lifecycle).toBe('removed')
    expect(store.read().managedWorktrees.find((item) => item.id === retained.id)?.lifecycle).toBe('archived')
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

describe('authorized archive lifecycle execution', () => {
  it('archives dirty unique work through a verified snapshot and restores it exactly without advancing task state', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, { hasRunningProcesses: async () => false })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-archive',
      taskName: 'Archive', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(worktree.path, 'file.txt'), 'unique commit\n')
    git(worktree.path, 'add', 'file.txt')
    git(worktree.path, 'commit', '-m', 'unique detached commit')
    const headSha = git(worktree.path, 'rev-parse', 'HEAD')
    fs.writeFileSync(path.join(worktree.path, 'binary.bin'), Buffer.from([0, 1, 2, 255]))
    git(worktree.path, 'add', 'binary.bin')
    fs.writeFileSync(path.join(worktree.path, 'binary.bin'), Buffer.from([9, 8, 0, 254]))
    fs.writeFileSync(path.join(worktree.path, 'script.sh'), '#!/bin/sh\necho restored\n', { mode: 0o755 })
    fs.writeFileSync(path.join(worktree.path, '.gitignore'), 'ignored.env\n')
    fs.writeFileSync(path.join(worktree.path, 'ignored.env'), 'discarded\n')
    const before = await captureLocalChanges(worktree.path, headSha)
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-archive', worktreeId: worktree.id,
      artifactId: 'artifact-archive', startedAt: Date.now(),
    })

    const prepared = await lifecycle.prepareArchive({ operationId: archive.id, worktreeId: worktree.id, snapshotStore: snapshots })
    const removed = await lifecycle.removePreparedArchive({
      operationId: archive.id,
      worktreeId: worktree.id,
      repositoryPath: repo,
      snapshotStore: snapshots,
      snapshot: prepared.snapshot,
    })

    expect(fs.existsSync(worktree.path)).toBe(false)
    expect(store.read().managedWorktrees.find((item) => item.id === worktree.id)?.lifecycle).toBe('active')
    expect(store.read().lifecycleOperations.find((item) => item.id === archive.id)?.receipts.map((receipt) => receipt.subphase))
      .toEqual(expect.arrayContaining(['privateRefAnchored', 'snapshotVerified', 'sourceNormalized', 'worktreeUnregistered']))

    await finishOperation(store, archive.id)
    await recordRemovedSnapshot(store, worktree.id, prepared.snapshot, prepared.headSha, prepared.privateRef)
    await lifecycle.purgeArchiveQuarantine(archive.id, worktree.id)
    const restore = await store.beginLifecycleOperation({
      kind: 'restore', taskId: 'task-archive', worktreeId: worktree.id,
      artifactId: prepared.snapshot.artifactId,
      restoreReservation: {
        path: worktree.path,
        gitCommonDir: worktree.gitCommonDir,
        privateRef: prepared.privateRef,
        ownershipToken: 'restore-token',
        reservedAt: Date.now(),
      },
      startedAt: Date.now(),
    })
    const restored = await lifecycle.restorePreparedArchive({
      operationId: restore.id,
      worktreeId: worktree.id,
      repositoryPath: repo,
      snapshotStore: snapshots,
      snapshot: prepared.snapshot,
    })

    await store.appendLifecycleReceipt(restore.id, {
      phase: 'restored', subphase: 'taskCommitted', recordedAt: Date.now(),
      receiptId: `${restore.id}:taskCommitted:restore`, details: { checkoutPath: restored.checkoutPath },
    })
    await lifecycle.retireRestoredSnapshot({
      operationId: restore.id,
      worktreeId: worktree.id,
      repositoryPath: repo,
      snapshotStore: snapshots,
      snapshot: prepared.snapshot,
    })

    expect(restored.checkoutPath).toBe(worktree.path)
    expect(localChangesEqual(await captureLocalChanges(worktree.path, headSha), before)).toBe(true)
    expect(fs.existsSync(path.join(worktree.path, 'ignored.env'))).toBe(false)
    expect(store.read().managedWorktrees.find((item) => item.id === worktree.id)?.lifecycle).toBe('removed')
    expect(fs.existsSync(removed.quarantinePath)).toBe(false)
    expect(store.read().lifecycleOperations.find((item) => item.id === archive.id)?.receipts)
      .toEqual(expect.arrayContaining([expect.objectContaining({ subphase: 'quarantinePurged' })]))
    expect(fs.existsSync(prepared.snapshot.artifactPath)).toBe(false)
    expect(() => git(repo, 'rev-parse', prepared.privateRef)).toThrow()
    expect(store.read().lifecycleOperations.find((item) => item.id === restore.id)?.receipts.map((receipt) => receipt.subphase))
      .toEqual(expect.arrayContaining(['taskCommitted', 'snapshotPurged', 'privateRefPurged']))
  })

  it('refuses to adopt a different worktree occupying the reserved restore path', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, { hasRunningProcesses: async () => false })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-occupied',
      taskName: 'Occupied', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-occupied', worktreeId: worktree.id,
      artifactId: 'artifact-occupied', startedAt: Date.now(),
    })
    const prepared = await lifecycle.prepareArchive({ operationId: archive.id, worktreeId: worktree.id, snapshotStore: snapshots })
    await lifecycle.removePreparedArchive({
      operationId: archive.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })
    await finishOperation(store, archive.id)
    await recordRemovedSnapshot(store, worktree.id, prepared.snapshot, prepared.headSha, prepared.privateRef)
    git(repo, 'worktree', 'add', '--detach', worktree.path, worktree.baseSha)
    const restore = await store.beginLifecycleOperation({
      kind: 'restore', taskId: 'task-occupied', worktreeId: worktree.id,
      artifactId: prepared.snapshot.artifactId,
      restoreReservation: {
        path: worktree.path, gitCommonDir: worktree.gitCommonDir, privateRef: prepared.privateRef,
        ownershipToken: 'occupied-token', reservedAt: Date.now(),
      },
      startedAt: Date.now(),
    })

    await expect(lifecycle.restorePreparedArchive({
      operationId: restore.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })).rejects.toThrow(/occupied by an unowned worktree/i)
  })

  it('restores detached when the archived branch moved after cleanup', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, { hasRunningProcesses: async () => false })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-branch',
      taskName: 'Branch', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    git(worktree.path, 'switch', '-c', 'feature/local-only')
    fs.writeFileSync(path.join(worktree.path, 'branch.txt'), 'branch work\n')
    git(worktree.path, 'add', 'branch.txt')
    git(worktree.path, 'commit', '-m', 'branch work')
    const headSha = git(worktree.path, 'rev-parse', 'HEAD')
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-branch', worktreeId: worktree.id,
      artifactId: 'artifact-branch', startedAt: Date.now(),
    })
    const prepared = await lifecycle.prepareArchive({ operationId: archive.id, worktreeId: worktree.id, snapshotStore: snapshots })
    await lifecycle.removePreparedArchive({
      operationId: archive.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })
    git(repo, 'branch', '-f', 'feature/local-only', worktree.baseSha)
    await finishOperation(store, archive.id)
    await recordRemovedSnapshot(store, worktree.id, prepared.snapshot, headSha, prepared.privateRef)
    const restore = await store.beginLifecycleOperation({
      kind: 'restore', taskId: 'task-branch', worktreeId: worktree.id,
      artifactId: prepared.snapshot.artifactId,
      restoreReservation: {
        path: worktree.path, gitCommonDir: worktree.gitCommonDir, privateRef: prepared.privateRef,
        ownershipToken: 'branch-token', reservedAt: Date.now(),
      },
      startedAt: Date.now(),
    })

    const result = await lifecycle.restorePreparedArchive({
      operationId: restore.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })

    expect(result.branchAttached).toBe(false)
    expect(result.fallbackReason).toMatch(/moved/i)
    expect(git(worktree.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD')
    expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(headSha)
  })

  it('blocks process and source races after snapshot verification without normalizing the source', async () => {
    const { root, repo, managedRoot, store } = fixture()
    let processChecks = 0
    const lifecycle = new WorktreeLifecycle(store, {
      hasRunningProcesses: async () => {
        processChecks += 1
        return processChecks > 1
      },
    })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-race',
      taskName: 'Race', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(worktree.path, 'dirty.txt'), 'preserved\n')
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-race', worktreeId: worktree.id,
      artifactId: 'artifact-race', startedAt: Date.now(),
    })
    const prepared = await lifecycle.prepareArchive({ operationId: operation.id, worktreeId: worktree.id, snapshotStore: snapshots })

    await expect(lifecycle.removePreparedArchive({
      operationId: operation.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })).rejects.toThrow(/running process/i)
    expect(fs.readFileSync(path.join(worktree.path, 'dirty.txt'), 'utf8')).toBe('preserved\n')
    expect(store.read().lifecycleOperations.find((item) => item.id === operation.id)?.receipts)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ subphase: 'sourceNormalized' })]))
  })

  it('reconstructs exact source state and records receipts when removal fails after normalization', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, {
      hasRunningProcesses: async () => false,
      removeGitWorktree: async () => { throw new Error('injected remove failure') },
    })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-reconstruct',
      taskName: 'Reconstruct', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(worktree.path, 'file.txt'), 'staged\n')
    git(worktree.path, 'add', 'file.txt')
    fs.appendFileSync(path.join(worktree.path, 'file.txt'), 'unstaged\n')
    fs.writeFileSync(path.join(worktree.path, 'untracked.txt'), 'untracked\n')
    fs.writeFileSync(path.join(worktree.path, '.gitignore'), 'ignored.txt\n')
    fs.writeFileSync(path.join(worktree.path, 'ignored.txt'), 'ignored\n')
    const headSha = git(worktree.path, 'rev-parse', 'HEAD')
    const beforeStatus = git(worktree.path, 'status', '--porcelain=v1', '--ignored')
    const before = await captureLocalChanges(worktree.path, headSha)
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-reconstruct', worktreeId: worktree.id,
      artifactId: 'artifact-reconstruct', startedAt: Date.now(),
    })
    const prepared = await lifecycle.prepareArchive({ operationId: operation.id, worktreeId: worktree.id, snapshotStore: snapshots })

    await expect(lifecycle.removePreparedArchive({
      operationId: operation.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })).rejects.toThrow('injected remove failure')

    expect(fs.existsSync(worktree.path)).toBe(true)
    expect(localChangesEqual(await captureLocalChanges(worktree.path, headSha), before)).toBe(true)
    expect(git(worktree.path, 'status', '--porcelain=v1', '--ignored')).toBe(beforeStatus)
    expect(store.read().lifecycleOperations.find((item) => item.id === operation.id)?.receipts.map((receipt) => receipt.subphase))
      .toEqual(expect.arrayContaining(['sourceEntryQuarantined', 'trackedReset', 'sourceReconstructed']))
  })

  it('purges only durable selectors and is idempotent after every owned artifact is gone', async () => {
    const { root, repo, managedRoot, store } = fixture()
    const lifecycle = new WorktreeLifecycle(store, { hasRunningProcesses: async () => false })
    const worktree = await lifecycle.create({
      projectId: 'project-12345678', projectName: 'Project', taskId: 'task-purge',
      taskName: 'Purge', localCheckoutPath: repo, managedRoot, baseRef: 'main', cap: 15,
    })
    fs.writeFileSync(path.join(worktree.path, 'untracked.txt'), 'purge me\n')
    const snapshots = new WorktreeSnapshotStore(path.join(root, 'snapshots'))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'task-purge', worktreeId: worktree.id,
      artifactId: 'artifact-purge', startedAt: Date.now(),
    })
    const prepared = await lifecycle.prepareArchive({ operationId: archive.id, worktreeId: worktree.id, snapshotStore: snapshots })
    const removed = await lifecycle.removePreparedArchive({
      operationId: archive.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })
    await finishOperation(store, archive.id)
    const deletion = await store.beginLifecycleOperation({
      kind: 'delete', taskId: 'task-purge', worktreeId: worktree.id,
      artifactId: prepared.snapshot.artifactId,
      purgeSelectors: {
        threadId: null,
        taskIds: ['task-purge'],
        worktreeIds: [worktree.id],
        artifactIds: [prepared.snapshot.artifactId],
        privateRefs: [prepared.privateRef],
        quarantinePaths: [removed.quarantinePath],
        snapshotPaths: [prepared.snapshot.artifactPath],
        ownershipManifestPaths: [worktree.manifestPath],
        pinIds: [],
      },
      startedAt: Date.now(),
    })

    await lifecycle.purgeOwnedArtifacts({
      operationId: deletion.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })
    await lifecycle.purgeOwnedArtifacts({
      operationId: deletion.id, worktreeId: worktree.id, repositoryPath: repo,
      snapshotStore: snapshots, snapshot: prepared.snapshot,
    })

    expect(fs.existsSync(prepared.snapshot.artifactPath)).toBe(false)
    expect(fs.existsSync(removed.quarantinePath)).toBe(false)
    expect(fs.existsSync(worktree.manifestPath)).toBe(false)
    expect(() => git(repo, 'rev-parse', prepared.privateRef)).toThrow()
    expect(store.read().lifecycleOperations.find((item) => item.id === deletion.id)?.receipts.map((receipt) => receipt.subphase))
      .toEqual(expect.arrayContaining(['snapshotPurged', 'privateRefPurged', 'quarantinePurged', 'ownershipManifestPurged']))
  })
})
