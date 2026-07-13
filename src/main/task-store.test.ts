import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electron.userDataPath } }))
import {
  EMPTY_TASK_STORE,
  TaskStore,
  TaskStoreCompatibilityError,
} from './task-store'

const tempDirs: string[] = []
beforeEach(() => { electron.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-')); tempDirs.push(electron.userDataPath) })
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('TaskStore', () => {
  const task = (id: string) => ({ id, projectId: 'project', threadId: null, checkoutId: 'local', worktreeId: null, role: 'root' as const, location: 'local' as const, state: 'draft' as const, baseRef: null, baseSha: null, environmentId: null, environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1 })

  it('persists nullable threads, pending first turns, and the Local lease', async () => {
    const store = new TaskStore()
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: 'task' }, tasks: [{ ...task('task'), baseRef: 'refs/heads/main', pendingFirstTurn: { payload: { input: [{ type: 'text', text: 'hello' }] }, delivery: 'pending' as const } }] }))
    expect(store.read()).toMatchObject({ localLeaseByProjectId: { project: 'task' }, tasks: [{ threadId: null, pendingFirstTurn: { delivery: 'pending' } }] })
  })

  it('migrates a revisionless v1 store with a validated byte-exact backup', () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const previous = `${target}.previous`
    const legacy = {
      version: 1,
      tasks: [],
      managedWorktrees: [],
      localLeaseByProjectId: {},
      interruptedOperations: [{ operation: 'legacy' }],
    }
    const legacyBytes = JSON.stringify(legacy)
    fs.writeFileSync(target, legacyBytes)

    expect(new TaskStore().read()).toMatchObject({
      version: 2,
      revision: 0,
      lifecycleOperations: [],
      interruptedOperations: [{ operation: 'legacy' }],
    })
    expect(fs.readFileSync(previous, 'utf8')).toBe(legacyBytes)
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toMatchObject({ version: 2, revision: 0 })
    expect(fs.statSync(target).mode & 0o777).toBe(0o600)
    expect(fs.statSync(previous).mode & 0o777).toBe(0o600)
  })

  it('increments the persisted revision exactly once per successful update', async () => {
    const store = new TaskStore()

    const first = await store.update((state) => ({ ...state, revision: 99, tasks: [task('one')] }))
    const second = await store.update((state) => ({ ...state, tasks: [...state.tasks, task('two')] }))

    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(store.read().revision).toBe(2)
  })

  it('notifies subscribers after commit with only derivable affected IDs', async () => {
    const store = new TaskStore()
    const subscriber = vi.fn(() => {
      expect(store.read().revision).toBe(1)
    })
    const unsubscribe = store.subscribe(subscriber)

    await store.update((state) => ({ ...state, tasks: [task('changed')] }))
    await store.update((state) => ({ ...state, localLeaseByProjectId: { project: 'changed' } }))
    unsubscribe()
    await store.update((state) => ({ ...state, interruptedOperations: [{ ignored: true }] }))

    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(subscriber).toHaveBeenNthCalledWith(1, { revision: 1, affectedIds: ['changed'] })
    expect(subscriber).toHaveBeenNthCalledWith(2, { revision: 2 })
  })

  it('does not notify subscribers when the atomic commit fails', async () => {
    const store = new TaskStore()
    const subscriber = vi.fn()
    store.subscribe(subscriber)
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed')
    })

    await expect(store.update((state) => ({ ...state, tasks: [task('lost')] }))).rejects.toThrow('rename failed')

    expect(subscriber).not.toHaveBeenCalled()
    expect(store.read().revision).toBe(0)
  })

  it('recovers the previous valid generation when the newest generation is corrupt', async () => {
    const store = new TaskStore()
    await store.update((state) => ({ ...state, tasks: [task('one')] }))
    await store.update((state) => ({ ...state, tasks: [...state.tasks, task('two')] }))
    fs.writeFileSync(path.join(electron.userDataPath, 'tasks.json'), 'corrupt')

    expect(new TaskStore().read()).toMatchObject({
      revision: 1,
      tasks: [{ id: 'one' }],
    })
  })

  it('selects the valid generation with the newest revision regardless of filename', async () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const previous = `${target}.previous`
    const store = new TaskStore()
    await store.update((state) => ({ ...state, tasks: [task('one')] }))
    const older = fs.readFileSync(target)
    await store.update((state) => ({ ...state, tasks: [...state.tasks, task('two')] }))
    const newer = fs.readFileSync(target)
    fs.writeFileSync(target, older)
    fs.writeFileSync(previous, newer)

    expect(new TaskStore().read()).toMatchObject({
      revision: 2,
      tasks: [{ id: 'one' }, { id: 'two' }],
    })
  })

  it('fails closed without modifying either invalid generation', () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const previous = `${target}.previous`
    fs.writeFileSync(target, 'broken-primary')
    fs.writeFileSync(previous, 'broken-previous')

    expect(() => new TaskStore().read()).toThrow(/authoritative task store/i)
    expect(fs.readFileSync(target, 'utf8')).toBe('broken-primary')
    expect(fs.readFileSync(previous, 'utf8')).toBe('broken-previous')
  })

  it('refuses an unknown newer version and leaves rollback evidence byte-identical', async () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const previous = `${target}.previous`
    const newerBytes = JSON.stringify({
      version: 3,
      revision: 12,
      lifecycleOperations: [{ futureReceipt: 'must-survive' }],
    })
    const previousBytes = JSON.stringify(EMPTY_TASK_STORE)
    fs.writeFileSync(target, newerBytes)
    fs.writeFileSync(previous, previousBytes)
    const store = new TaskStore()

    expect(() => store.read()).toThrow(TaskStoreCompatibilityError)
    await expect(store.update((state) => state)).rejects.toThrow(TaskStoreCompatibilityError)
    expect(fs.readFileSync(target, 'utf8')).toBe(newerBytes)
    expect(fs.readFileSync(previous, 'utf8')).toBe(previousBytes)
  })

  it('leaves v1 authoritative when migration backup publication is interrupted', () => {
    const target = path.join(electron.userDataPath, 'tasks.json')
    const legacyBytes = JSON.stringify({
      version: 1,
      revision: 4,
      tasks: [],
      managedWorktrees: [],
      localLeaseByProjectId: {},
      interruptedOperations: [{ operation: 'preserve-me' }],
    })
    fs.writeFileSync(target, legacyBytes)
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('backup rename failed')
    })

    expect(() => new TaskStore().read()).toThrow(/authoritative task store/i)
    expect(fs.readFileSync(target, 'utf8')).toBe(legacyBytes)

    vi.restoreAllMocks()
    expect(new TaskStore().read()).toMatchObject({
      version: 2,
      revision: 4,
      interruptedOperations: [{ operation: 'preserve-me' }],
    })
  })

  it('fails before rename when flushing a temporary generation fails', async () => {
    const store = new TaskStore()
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
      throw new Error('file flush failed')
    })

    await expect(store.update((state) => ({ ...state, tasks: [task('lost')] })))
      .rejects.toThrow('file flush failed')
    expect(store.read()).toEqual(EMPTY_TASK_STORE)
  })

  it('recovers a renamed commit when the final directory flush outcome is unknown', async () => {
    const store = new TaskStore()
    let flushCount = 0
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      flushCount += 1
      if (flushCount === 4) throw new Error('directory flush failed')
    })

    await expect(store.update((state) => ({ ...state, tasks: [task('committed')] })))
      .rejects.toThrow('directory flush failed')
    expect(new TaskStore().read()).toMatchObject({ revision: 1, tasks: [{ id: 'committed' }] })
  })

  it('reuses preallocated identities for duplicate lifecycle intent', async () => {
    const store = new TaskStore()
    const intent = {
      kind: 'archive' as const,
      taskId: 'task',
      worktreeId: 'worktree',
      startedAt: 10,
    }

    const first = await store.beginLifecycleOperation(intent)
    const duplicate = await store.beginLifecycleOperation({ ...intent, startedAt: 20 })

    expect(duplicate).toEqual(first)
    expect(first.artifactId).toBeTruthy()
    expect(store.read().lifecycleOperations).toEqual([first])
    expect(store.read().revision).toBe(1)
  })

  it('rejects a conflicting lifecycle operation under the same authority lock', async () => {
    const store = new TaskStore()
    await store.beginLifecycleOperation({
      kind: 'archive',
      taskId: 'task',
      worktreeId: 'worktree',
      startedAt: 10,
    })

    await expect(store.beginLifecycleOperation({
      kind: 'delete',
      taskId: 'task',
      worktreeId: 'worktree',
      artifactId: null,
      purgeSelectors: {
        threadId: null,
        taskIds: ['task'],
        worktreeIds: ['worktree'],
        artifactIds: [],
        privateRefs: [],
        quarantinePaths: [],
        snapshotPaths: [],
        ownershipManifestPaths: [],
        pinIds: [],
      },
      startedAt: 11,
    })).rejects.toThrow(/active archive operation/i)
    expect(store.read().revision).toBe(1)
  })

  it('publishes lifecycle authority changes with task and worktree IDs', async () => {
    const store = new TaskStore()
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    await store.beginLifecycleOperation({
      kind: 'archive',
      taskId: 'task',
      worktreeId: 'worktree',
      startedAt: 10,
    })

    expect(subscriber).toHaveBeenCalledWith({
      revision: 1,
      affectedIds: ['task', 'worktree'],
    })
  })

  it('persists complete delete purge selectors across restart', async () => {
    const store = new TaskStore()
    const purgeSelectors = {
      threadId: 'thread',
      taskIds: ['task'],
      worktreeIds: ['worktree'],
      artifactIds: ['artifact'],
      privateRefs: ['refs/cranberri/tasks/task/archive'],
      quarantinePaths: ['/data/quarantine'],
      snapshotPaths: ['/data/snapshot'],
      ownershipManifestPaths: ['/data/ownership.json'],
      pinIds: ['pin'],
    }
    await store.beginLifecycleOperation({
      kind: 'delete',
      taskId: 'task',
      worktreeId: 'worktree',
      artifactId: 'artifact',
      purgeSelectors,
      startedAt: 10,
    })

    expect(new TaskStore().read().lifecycleOperations[0]?.purgeSelectors).toEqual(purgeSelectors)
  })

  it('persists an attributable restore reservation across restart', async () => {
    const store = new TaskStore()
    const restoreReservation = {
      path: '/managed/task',
      gitCommonDir: '/repo/.git',
      privateRef: 'refs/cranberri/tasks/task/archive',
      ownershipToken: 'ownership-token',
      reservedAt: 9,
    }
    await store.beginLifecycleOperation({
      kind: 'restore',
      taskId: 'task',
      worktreeId: 'worktree',
      artifactId: 'artifact',
      restoreReservation,
      startedAt: 10,
    })

    expect(new TaskStore().read().lifecycleOperations[0]?.restoreReservation).toEqual(restoreReservation)
  })

  it('round-trips destructive phase receipts, unknown RPC outcome, and retry state', async () => {
    const store = new TaskStore()
    const operation = await store.beginLifecycleOperation({
      kind: 'archive',
      taskId: 'task',
      worktreeId: 'worktree',
      startedAt: 10,
    })
    await store.update((state) => ({
      ...state,
      lifecycleOperations: state.lifecycleOperations?.map((candidate) => candidate.id === operation.id
        ? {
            ...candidate,
            status: 'needsAttention' as const,
            phase: 'threadArchiveRequested' as const,
            receipts: [{
              phase: 'threadArchiveRequested' as const,
              subphase: 'rpcRequested' as const,
              recordedAt: 11,
              receiptId: 'request-1',
              details: { rpcRequestId: 'request-1' },
            }],
            rpc: {
              action: 'archiveThread' as const,
              status: 'unknown' as const,
              requestedAt: 11,
              observedAt: null,
            },
            updatedAt: 12,
            retry: { attempt: 1, retryable: true, nextAttemptAt: 20 },
            lastError: { code: 'CONNECTION_LOST', message: 'response unknown', recordedAt: 12 },
          }
        : candidate),
    }))

    expect(new TaskStore().read().lifecycleOperations[0]).toMatchObject({
      phase: 'threadArchiveRequested',
      receipts: [{
        subphase: 'rpcRequested',
        receiptId: 'request-1',
        details: { rpcRequestId: 'request-1' },
      }],
      rpc: { action: 'archiveThread', status: 'unknown' },
      retry: { attempt: 1, retryable: true, nextAttemptAt: 20 },
      lastError: { code: 'CONNECTION_LOST' },
    })
  })

  it('serializes two concurrent writes without dropping either task', async () => {
    const store = new TaskStore()
    const add = (id: string) => store.update(async (state) => { await new Promise((resolve) => setTimeout(resolve, id === 'one' ? 10 : 0)); return { ...state, tasks: [...state.tasks, task(id)] } })
    await Promise.all([add('one'), add('two')])
    expect(store.read().tasks.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it('preserves corrupt authoritative bytes', () => {
    const target = path.join(electron.userDataPath, 'tasks.json'); fs.writeFileSync(target, 'broken'); const store = new TaskStore()
    expect(() => store.read()).toThrow(/task store/i); expect(fs.readFileSync(target, 'utf8')).toBe('broken')
  })

  it('resolves the default user-data path lazily', async () => {
    const store = new TaskStore()
    const nextUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-tasks-late-path-'))
    tempDirs.push(nextUserData)
    electron.userDataPath = nextUserData

    await store.update((state) => ({ ...state, tasks: [task('late')] }))

    expect(fs.existsSync(path.join(nextUserData, 'tasks.json'))).toBe(true)
    expect(store.read().tasks[0]?.id).toBe('late')
  })
})
