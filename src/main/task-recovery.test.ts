import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LifecycleOperation, Task } from '../shared/tasks'
import type { WorktreeSnapshotDescriptor } from '../shared/worktree-snapshots'
import type { ManagedWorktree } from '../shared/worktrees'
import { TaskStore } from './task-store'
import {
  classifyThreadForOperation,
  handoffRecoveryCommand,
  reconcileTaskStore,
  type TaskRecoveryDependencies,
} from './task-recovery'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => execFileSync('/usr/bin/trash', [root])))

function task(id: string, state: Task['state'], threadId = `thread-${id}`): Task {
  return {
    id, projectId: 'project', threadId, checkoutId: 'local', worktreeId: null,
    role: 'root', location: 'local', state, baseRef: 'refs/heads/main', baseSha: null,
    environmentId: null, environmentRevision: null, pendingFirstTurn: null,
    createdAt: 1, updatedAt: 1, archivedAt: state === 'archived' ? 1 : null,
  }
}

function snapshot(root: string, taskId: string, worktreeId: string): WorktreeSnapshotDescriptor {
  return {
    version: 1,
    artifactId: `artifact-${taskId}`,
    taskId,
    worktreeId,
    artifactPath: path.join(root, `${taskId}.snapshot`),
    artifactBytes: 1,
    artifactDigestSha256: 'a'.repeat(64),
    headSha: 'b'.repeat(40),
    bundleIncluded: false,
  }
}

function managedWorktree(
  root: string,
  taskId: string,
  lifecycle: ManagedWorktree['lifecycle'],
  descriptor: WorktreeSnapshotDescriptor | null = null,
): ManagedWorktree {
  return {
    id: `worktree-${taskId}`, projectId: 'project', checkoutId: `checkout-${taskId}`, taskId,
    path: path.join(root, `checkout-${taskId}`), recordedRoot: root,
    gitCommonDir: path.join(root, 'repository.git'),
    manifestPath: path.join(root, '.cranberri', 'manifests', `${taskId}.json`),
    baseRef: 'refs/heads/main', baseSha: 'b'.repeat(40), branch: null,
    headSha: 'b'.repeat(40), archiveHeadSha: descriptor?.headSha ?? null,
    privateRef: descriptor ? `refs/cranberri/tasks/${taskId}` : null,
    snapshot: descriptor, lifecycle, cleanupReason: null, createdAt: 1, updatedAt: 1,
    archivedAt: lifecycle === 'active' ? null : 1,
    environmentRevision: null,
  }
}

async function markRpcUnknown(
  store: TaskStore,
  operation: LifecycleOperation,
  action: NonNullable<LifecycleOperation['rpc']>['action'],
): Promise<void> {
  await store.updateLifecycleOperation(operation.id, (candidate) => ({
    ...candidate,
    status: 'needsAttention',
    phase: 'needsAttention',
    rpc: { action, status: 'unknown', requestedAt: 2, observedAt: null },
    updatedAt: 2,
    lastError: { code: 'CODEX_RPC_UNKNOWN', message: 'connection lost', recordedAt: 2 },
  }))
}

describe('task startup recovery', () => {
  it.each([
    ['archive', 'active', 'request'],
    ['archive', 'archived', 'observed'],
    ['archive', 'missing', 'needsAttention'],
    ['restore', 'active', 'observed'],
    ['restore', 'archived', 'request'],
    ['restore', 'missing', 'needsAttention'],
    ['delete', 'active', 'request'],
    ['delete', 'archived', 'request'],
    ['delete', 'missing', 'observed'],
  ] as const)('classifies %s against a %s thread as %s', (kind, threadState, expected) => {
    expect(classifyThreadForOperation(kind, threadState)).toBe(expected)
  })

  it.each([
    ['preflight', 'discard'],
    ['captured', 'discard'],
    ['branchReleased', 'rollback'],
    ['applied', 'rollback'],
    ['resumed', 'rollback'],
    ['rollback', 'rollback'],
    ['needsAttention', 'rollback'],
  ] as const)('recommends %s handoff recovery as %s', (phase, command) => {
    expect(handoffRecoveryCommand(phase)).toBe(command)
  })

  it('makes interrupted work retryable and releases stale Local leases', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const task = (id: string, state: 'provisioning' | 'setup' | 'active') => ({
      id, projectId: 'project', threadId: null, checkoutId: 'local', worktreeId: null,
      role: 'root' as const, location: 'worktree' as const, state, baseRef: 'main', baseSha: null,
      environmentId: null, environmentRevision: null,
      pendingFirstTurn: state === 'active' ? { payload: { input: [{ type: 'text', text: 'keep' }] }, delivery: 'sending' as const } : null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    })
    await store.update((state) => ({
      ...state,
      tasks: [task('draft', 'provisioning'), task('setup', 'setup'), task('sending', 'active')],
      localLeaseByProjectId: { project: 'sending' },
      interruptedOperations: [{ taskId: 'missing', operation: 'create' }],
    }))

    await reconcileTaskStore(store, 10)
    const recovered = store.read()
    expect(recovered.tasks.map((candidate) => candidate.state)).toEqual(['draft', 'failed', 'active'])
    expect(recovered.tasks[2].pendingFirstTurn?.delivery).toBe('sending')
    expect(recovered.localLeaseByProjectId.project).toBeNull()
    expect(recovered.interruptedOperations).toEqual([])
  })

  it('preserves control-task history as a normal Local session and drops empty controls', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const control = (id: string, threadId: string | null) => ({
      id, projectId: 'project', threadId, checkoutId: 'local', worktreeId: null,
      role: 'control' as const, location: 'local' as const, state: 'local' as const,
      baseRef: 'refs/heads/main', baseSha: null, environmentId: null,
      environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1,
      archivedAt: null,
    })
    await store.update((state) => ({
      ...state,
      tasks: [control('kept', 'thread-1'), control('empty', null)],
      localLeaseByProjectId: { project: 'kept' },
    }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks).toEqual([
      expect.objectContaining({ id: 'kept', threadId: 'thread-1', role: 'root', location: 'local' }),
    ])
    expect(store.read().localLeaseByProjectId.project).toBeNull()
  })

  it('recreates an empty prepared thread after restart before retrying its first turn', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'pending', projectId: 'project', threadId: 'empty-thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'local', baseRef: 'refs/heads/main', baseSha: null,
      environmentId: null, environmentRevision: null,
      pendingFirstTurn: { payload: { input: [{ type: 'text', text: 'retry me' }] }, delivery: 'pending' },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      threadId: null,
      pendingFirstTurn: { delivery: 'pending' },
      updatedAt: 10,
    })
  })

  it('restores a pre-provisioning Local binding after restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'local', projectId: 'project', threadId: 'thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'provisioning', baseRef: 'refs/heads/feature', baseSha: null,
      environmentId: 'node', environmentRevision: 'a'.repeat(64), pendingFirstTurn: null,
      worktreeTransition: {
        phase: 'provisioning', previousCheckoutId: 'local', previousBaseRef: 'refs/heads/main',
        previousBaseSha: null, previousEnvironmentId: null, previousEnvironmentRevision: null,
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      location: 'local', state: 'local', checkoutId: 'local', baseRef: 'refs/heads/main',
      environmentId: null, environmentRevision: null, worktreeTransition: null,
    })
  })

  it('recovers a worktree created before its task binding persisted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const worktreePath = path.join(root, 'worktree')
    fs.mkdirSync(worktreePath)
    await store.update((state) => ({ ...state, tasks: [{
      id: 'task', projectId: 'project', threadId: 'thread', checkoutId: 'local', worktreeId: null,
      role: 'root', location: 'local', state: 'provisioning', baseRef: 'refs/heads/main', baseSha: null,
      environmentId: null, environmentRevision: null, pendingFirstTurn: null,
      worktreeTransition: {
        phase: 'resuming', previousCheckoutId: 'local', previousBaseRef: 'refs/heads/main',
        previousBaseSha: null, previousEnvironmentId: null, previousEnvironmentRevision: null,
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }], managedWorktrees: [{
      id: 'worktree', projectId: 'project', checkoutId: 'managed', taskId: 'task', path: worktreePath,
      recordedRoot: root, gitCommonDir: root, manifestPath: path.join(root, 'manifest.json'),
      baseRef: 'refs/heads/main', baseSha: 'a'.repeat(40), branch: null, headSha: 'a'.repeat(40),
      archiveHeadSha: null, privateRef: null, lifecycle: 'active', cleanupReason: null,
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    await reconcileTaskStore(store, 10)

    expect(store.read().tasks[0]).toMatchObject({
      checkoutId: 'managed', worktreeId: 'worktree', location: 'worktree', state: 'needsAttention',
      worktreeTransition: { phase: 'needsAttention', error: expect.stringContaining('before binding') },
    })
  })

  it('does not create another store revision after recovery has settled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: null } }))

    await reconcileTaskStore(store, 10)
    const revision = store.read().revision
    await reconcileTaskStore(store, 20)

    expect(store.read().revision).toBe(revision)
  })

  it('preserves interrupted handoff phase during startup reconciliation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({ ...state, tasks: [{
      id: 'handoff', projectId: 'project', threadId: 'thread', checkoutId: 'managed', worktreeId: 'worktree',
      role: 'root', location: 'worktree', state: 'handingOff', baseRef: 'refs/heads/feature', baseSha: 'a'.repeat(40),
      environmentId: null, environmentRevision: null, pendingFirstTurn: null,
      handoff: {
        direction: 'toLocal', phase: 'captured', branch: 'feature', bundlePath: path.join(root, 'bundle.json'),
        startedAt: 1, error: null,
      },
      createdAt: 1, updatedAt: 1, archivedAt: null,
    }] }))

    const result = await reconcileTaskStore(store, 10)

    expect(result.handoffRecoveries).toEqual([{
      taskId: 'handoff', phase: 'captured', command: 'discard',
    }])
    expect(store.read().tasks[0]).toMatchObject({
      state: 'handingOff', handoff: { phase: 'captured' }, updatedAt: 1,
    })
    expect(store.read().localLeaseByProjectId.project).toBe('handoff')
  })

  it('observes unknown Local archive, restore, and delete outcomes and settles them idempotently', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    await store.update((state) => ({
      ...state,
      tasks: [task('archive', 'local'), task('restore', 'archived'), task('delete', 'archived')],
    }))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'archive', worktreeId: null, startedAt: 2,
    })
    const restore = await store.beginLifecycleOperation({
      kind: 'restore', taskId: 'restore', worktreeId: null, artifactId: null,
      restoreReservation: null, startedAt: 2,
    })
    const deletion = await store.beginLifecycleOperation({
      kind: 'delete', taskId: 'delete', worktreeId: null, artifactId: null,
      purgeSelectors: {
        threadId: 'thread-delete', taskIds: ['delete'], worktreeIds: [], artifactIds: [],
        privateRefs: [], quarantinePaths: [], snapshotPaths: [], ownershipManifestPaths: [], pinIds: [],
      },
      startedAt: 2,
    })
    await markRpcUnknown(store, archive, 'archiveThread')
    await markRpcUnknown(store, restore, 'unarchiveThread')
    await markRpcUnknown(store, deletion, 'deleteThread')
    const inspections = new Map<string, 'active' | 'archived' | 'missing'>([
      ['thread-archive', 'archived'],
      ['thread-restore', 'active'],
      ['thread-delete', 'missing'],
    ] as const)
    const dependencies: TaskRecoveryDependencies = {
      codex: {
        inspectThreadLifecycle: async (threadId) => {
          const state = inspections.get(threadId) ?? 'missing'
          return state === 'missing'
            ? { threadId, state, cwd: null }
            : { threadId, state, cwd: '/repo' }
        },
        archiveThread: async () => undefined,
        unarchiveThread: async () => ({}),
        deleteThread: async () => undefined,
      },
    }

    const first = await reconcileTaskStore(store, 10, dependencies)
    const firstRevision = store.read().revision
    const second = await reconcileTaskStore(store, 20, dependencies)
    const settled = store.read()

    expect(first.lifecycleRecoveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'archive', kind: 'archive', status: 'repaired', threadState: 'archived' }),
      expect.objectContaining({ taskId: 'restore', kind: 'restore', status: 'repaired', threadState: 'active' }),
      expect.objectContaining({ taskId: 'delete', kind: 'delete', status: 'repaired', threadState: 'missing' }),
    ]))
    expect(settled.tasks.map((candidate) => [candidate.id, candidate.state])).toEqual([
      ['archive', 'archived'],
      ['restore', 'local'],
    ])
    expect(settled.lifecycleOperations.map((operation) => operation.status)).toEqual([
      'completed', 'completed', 'completed',
    ])
    expect(settled.lifecycleOperations.map((operation) => operation.rpc?.status)).toEqual([
      'observed', 'observed', 'observed',
    ])
    expect(second.changed).toBe(false)
    expect(store.read().revision).toBe(firstRevision)
  })

  it('resumes unfinished archive removal, restore checkout, and post-delete purge receipts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const archiveSnapshot = snapshot(root, 'archive', 'worktree-archive')
    const restoreSnapshot = snapshot(root, 'restore', 'worktree-restore')
    const deleteSnapshot = snapshot(root, 'delete', 'worktree-delete')
    const worktrees = [
      managedWorktree(root, 'archive', 'active'),
      managedWorktree(root, 'restore', 'removed', restoreSnapshot),
      managedWorktree(root, 'delete', 'removed', deleteSnapshot),
    ]
    await store.update((state) => ({
      ...state,
      tasks: [
        { ...task('archive', 'active'), checkoutId: 'checkout-archive', worktreeId: 'worktree-archive', location: 'worktree' },
        { ...task('restore', 'archived'), checkoutId: 'checkout-restore', worktreeId: 'worktree-restore', location: 'worktree' },
        { ...task('delete', 'archived'), checkoutId: 'checkout-delete', worktreeId: 'worktree-delete', location: 'worktree' },
      ],
      managedWorktrees: worktrees,
    }))
    const archive = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'archive', worktreeId: 'worktree-archive',
      artifactId: archiveSnapshot.artifactId, startedAt: 2,
    })
    const restore = await store.beginLifecycleOperation({
      kind: 'restore', taskId: 'restore', worktreeId: 'worktree-restore',
      artifactId: restoreSnapshot.artifactId,
      restoreReservation: {
        path: worktrees[1].path, gitCommonDir: worktrees[1].gitCommonDir,
        privateRef: worktrees[1].privateRef!, ownershipToken: 'restore-token', reservedAt: 2,
      },
      startedAt: 2,
    })
    const deletion = await store.beginLifecycleOperation({
      kind: 'delete', taskId: 'delete', worktreeId: 'worktree-delete',
      artifactId: deleteSnapshot.artifactId,
      purgeSelectors: {
        threadId: 'thread-delete', taskIds: ['delete'], worktreeIds: ['worktree-delete'],
        artifactIds: [deleteSnapshot.artifactId], privateRefs: [worktrees[2].privateRef!],
        quarantinePaths: [path.join(root, '.cranberri', 'quarantine', 'delete')],
        snapshotPaths: [deleteSnapshot.artifactPath], ownershipManifestPaths: [worktrees[2].manifestPath],
        pinIds: [],
      },
      startedAt: 2,
    })
    await markRpcUnknown(store, archive, 'archiveThread')
    await markRpcUnknown(store, restore, 'unarchiveThread')
    await markRpcUnknown(store, deletion, 'deleteThread')
    const prepareArchive = vi.fn(async () => ({
      snapshot: archiveSnapshot, headSha: archiveSnapshot.headSha,
      privateRef: 'refs/cranberri/tasks/archive', sourceGuard: 'guard',
    }))
    const removePreparedArchive = vi.fn(async () => ({
      headSha: archiveSnapshot.headSha, privateRef: 'refs/cranberri/tasks/archive',
      quarantinePath: path.join(root, '.cranberri', 'quarantine', archive.id),
    }))
    const restorePreparedArchive = vi.fn(async () => ({
      checkoutPath: worktrees[1].path, branchAttached: false, fallbackReason: null,
    }))
    const retireRestoredSnapshot = vi.fn(async () => undefined)
    const purgeOwnedArtifacts = vi.fn(async () => undefined)
    const purgeArchiveQuarantine = vi.fn(async () => undefined)
    const dependencies: TaskRecoveryDependencies = {
      codex: {
        inspectThreadLifecycle: async (threadId) => {
          if (threadId === 'thread-delete') return { threadId, state: 'missing', cwd: null }
          return { threadId, state: threadId === 'thread-restore' ? 'active' : 'archived', cwd: '/repo' }
        },
        archiveThread: async () => undefined,
        unarchiveThread: async () => ({}),
        deleteThread: async () => undefined,
      },
      worktrees: {
        prepareArchive,
        removePreparedArchive,
        restorePreparedArchive,
        retireRestoredSnapshot,
        purgeOwnedArtifacts,
        purgeArchiveQuarantine,
      },
      snapshotStore: {} as TaskRecoveryDependencies['snapshotStore'],
      repositoryPath: () => '/repo',
      restoreEnvironment: async () => undefined,
    }

    await reconcileTaskStore(store, 10, dependencies)

    expect(prepareArchive).toHaveBeenCalledWith(expect.objectContaining({ operationId: archive.id }))
    expect(removePreparedArchive).toHaveBeenCalledWith(expect.objectContaining({ snapshot: archiveSnapshot }))
    expect(restorePreparedArchive).toHaveBeenCalledWith(expect.objectContaining({ operationId: restore.id }))
    expect(retireRestoredSnapshot).toHaveBeenCalledWith(expect.objectContaining({ operationId: restore.id }))
    expect(purgeOwnedArtifacts).toHaveBeenCalledWith(expect.objectContaining({ operationId: deletion.id }))
    expect(purgeArchiveQuarantine).toHaveBeenCalledWith(archive.id, 'worktree-archive')
    expect(store.read().tasks.map((candidate) => [candidate.id, candidate.state])).toEqual([
      ['archive', 'archived'],
      ['restore', 'active'],
    ])
    expect(store.read().managedWorktrees.find((candidate) => candidate.id === 'worktree-restore')).toMatchObject({
      lifecycle: 'active', snapshot: null, privateRef: null, archiveHeadSha: null,
    })
  })

  it('finishes archive quarantine after a crash between task commit and final receipt', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const descriptor = snapshot(root, 'archive', 'worktree-archive')
    const worktree = managedWorktree(root, 'archive', 'removed', descriptor)
    await store.update((state) => ({
      ...state,
      tasks: [{
        ...task('archive', 'archived'), checkoutId: worktree.checkoutId,
        worktreeId: worktree.id, location: 'worktree',
      }],
      managedWorktrees: [worktree],
    }))
    const operation = await store.beginLifecycleOperation({
      kind: 'archive', taskId: 'archive', worktreeId: worktree.id,
      artifactId: descriptor.artifactId, startedAt: 2,
    })
    await store.updateLifecycleOperation(operation.id, (candidate) => ({
      ...candidate,
      status: 'completed',
      phase: 'archived',
      rpc: { action: 'archiveThread', status: 'observed', requestedAt: 2, observedAt: 3 },
      updatedAt: 3,
    }))
    const purgeArchiveQuarantine = vi.fn(async () => {
      await store.appendLifecycleReceipt(operation.id, {
        phase: 'archived', subphase: 'quarantinePurged', recordedAt: 10,
        receiptId: `${operation.id}:quarantinePurged`, details: { quarantinePath: path.join(root, 'quarantine') },
      })
    })
    const dependencies: TaskRecoveryDependencies = {
      codex: {
        inspectThreadLifecycle: async (threadId) => ({ threadId, state: 'archived', cwd: '/repo' }),
        archiveThread: async () => undefined,
        unarchiveThread: async () => ({}),
        deleteThread: async () => undefined,
      },
      worktrees: {
        prepareArchive: vi.fn(),
        removePreparedArchive: vi.fn(),
        restorePreparedArchive: vi.fn(),
        retireRestoredSnapshot: vi.fn(),
        purgeOwnedArtifacts: vi.fn(),
        purgeArchiveQuarantine,
      },
      snapshotStore: { load: vi.fn() } as unknown as TaskRecoveryDependencies['snapshotStore'],
      repositoryPath: () => '/repo',
    }

    await reconcileTaskStore(store, 10, dependencies)
    const revision = store.read().revision
    await reconcileTaskStore(store, 20, dependencies)

    expect(purgeArchiveQuarantine).toHaveBeenCalledTimes(1)
    expect(store.read().revision).toBe(revision)
  })

  it('preserves ignored legacy archive bytes across repeated startup migration attempts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-recovery-'))
    roots.push(root)
    const repositoryPath = path.join(root, 'repository')
    const worktreePath = path.join(root, 'managed')
    execFileSync('git', ['init', '-b', 'main', repositoryPath])
    execFileSync('git', ['-C', repositoryPath, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', repositoryPath, 'config', 'user.name', 'Test User'])
    fs.writeFileSync(path.join(repositoryPath, '.gitignore'), '.env\n*.db\n')
    fs.writeFileSync(path.join(repositoryPath, 'tracked.txt'), 'tracked\n')
    execFileSync('git', ['-C', repositoryPath, 'add', '.'])
    execFileSync('git', ['-C', repositoryPath, 'commit', '-m', 'initial'])
    execFileSync('git', ['-C', repositoryPath, 'worktree', 'add', '--detach', worktreePath, 'HEAD'])
    const envPath = path.join(worktreePath, '.env')
    const databasePath = path.join(worktreePath, 'cache.db')
    fs.writeFileSync(envPath, 'TOKEN=do-not-touch\n', { mode: 0o600 })
    fs.writeFileSync(databasePath, Buffer.from([0, 1, 2, 3]), { mode: 0o640 })
    const before = [envPath, databasePath].map((filePath) => ({
      filePath,
      bytes: fs.readFileSync(filePath),
      mode: fs.statSync(filePath).mode & 0o777,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }))
    const store = new TaskStore(path.join(root, 'tasks.json'))
    const legacy = managedWorktree(root, 'legacy', 'archived')
    legacy.path = worktreePath
    legacy.gitCommonDir = fs.realpathSync(path.join(repositoryPath, '.git'))
    legacy.manifestPath = path.join(root, '.cranberri', 'manifests', 'legacy.json')
    fs.mkdirSync(path.dirname(legacy.manifestPath), { recursive: true })
    fs.writeFileSync(legacy.manifestPath, JSON.stringify({
      version: 1, worktreeId: legacy.id, projectId: legacy.projectId, taskId: 'legacy',
      checkoutPath: worktreePath, gitCommonDir: legacy.gitCommonDir, createdAt: legacy.createdAt,
    }))
    await store.update((state) => ({
      ...state,
      tasks: [{ ...task('legacy', 'archived'), checkoutId: legacy.checkoutId, worktreeId: legacy.id, location: 'worktree' }],
      managedWorktrees: [legacy],
    }))
    const prepareArchive = vi.fn()
    const dependencies: TaskRecoveryDependencies = {
      codex: {
        inspectThreadLifecycle: async (threadId) => ({ threadId, state: 'archived', cwd: worktreePath }),
        archiveThread: async () => undefined,
        unarchiveThread: async () => ({}),
        deleteThread: async () => undefined,
      },
      worktrees: {
        prepareArchive,
        removePreparedArchive: vi.fn(),
        restorePreparedArchive: vi.fn(),
        retireRestoredSnapshot: vi.fn(),
        purgeOwnedArtifacts: vi.fn(),
        purgeArchiveQuarantine: vi.fn(),
      },
      snapshotStore: {} as TaskRecoveryDependencies['snapshotStore'],
      repositoryPath: () => repositoryPath,
      restoreEnvironment: async () => undefined,
    }

    const first = await reconcileTaskStore(store, 10, dependencies)
    const revision = store.read().revision
    const second = await reconcileTaskStore(store, 20, dependencies)

    expect(first.lifecycleRecoveries).toContainEqual(expect.objectContaining({
      taskId: 'legacy', kind: 'legacyArchive', status: 'needsAttention', reason: 'ignoredContent',
    }))
    expect(second.changed).toBe(false)
    expect(store.read().revision).toBe(revision)
    expect(store.read().managedWorktrees[0]).toMatchObject({
      lifecycle: 'cleanupBlocked', cleanupReason: expect.stringMatching(/ignored content/i),
    })
    expect(prepareArchive).not.toHaveBeenCalled()
    for (const expected of before) {
      expect(fs.readFileSync(expected.filePath)).toEqual(expected.bytes)
      expect(fs.statSync(expected.filePath).mode & 0o777).toBe(expected.mode)
      expect(fs.statSync(expected.filePath).mtimeMs).toBe(expected.mtimeMs)
    }
  })

})
