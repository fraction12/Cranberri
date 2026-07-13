import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CranberriAppState, WorkspaceWindowState } from '../shared/appState'
import { DEFAULT_APP_STATE } from '../shared/appState'
import type { ProjectRegistry } from '../shared/projects'
import type { Task } from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import { TaskStore } from './task-store'
import {
  authoritativeThreadCheck,
  configureStartupRecoveryRuntime,
  getStartupHandoffRecoveries,
  reconcileStartup,
  retryStartupRecovery,
} from './startup-recovery'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => execFileSync('/usr/bin/trash', [root])))

function fixture(): {
  root: string
  store: TaskStore
  registry: ProjectRegistry
  state: CranberriAppState
  task: Task
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-startup-recovery-'))
  roots.push(root)
  const localPath = path.join(root, 'local')
  fs.mkdirSync(localPath)
  const registry: ProjectRegistry = {
    version: 1,
    projects: [{
      id: 'project', name: 'Project', gitCommonDir: path.join(localPath, '.git'),
      localCheckoutId: 'local', pinnedLocalBranch: 'main', defaultEnvironmentId: null,
      controlTaskId: 'control-project', localLeaseTaskId: null,
    }],
    checkouts: [{
      id: 'local', projectId: 'project', kind: 'local', canonicalPath: localPath,
      gitCommonDir: path.join(localPath, '.git'), ownership: 'user', available: true,
    }],
    activeProjectId: 'project',
  }
  const task: Task = {
    id: 'task', projectId: 'project', threadId: 'thread', checkoutId: 'local',
    worktreeId: null, role: 'root', location: 'local', state: 'local',
    baseRef: 'refs/heads/main', baseSha: null, environmentId: null,
    environmentRevision: null, pendingFirstTurn: null, createdAt: 1, updatedAt: 1,
    archivedAt: null,
  }
  const window: WorkspaceWindowState = {
    id: 'window', type: 'chat', title: 'Chat', projectId: 'project', taskId: task.id,
    checkoutId: 'local', sessionTarget: 'local', threadId: 'thread', bindingRevision: 3,
  }
  return {
    root,
    store: new TaskStore(path.join(root, 'tasks.json')),
    registry,
    state: {
      ...DEFAULT_APP_STATE,
      workspacesByProjectId: { project: { windows: [window], activeWindowId: window.id } },
    },
    task,
  }
}

async function seed(store: TaskStore, tasks: Task[], managedWorktrees: ManagedWorktree[] = []): Promise<void> {
  await store.update((state) => ({ ...state, tasks, managedWorktrees }))
}

describe('startup recovery', () => {
  it('classifies only an authoritative thread-not-found response as missing', async () => {
    await expect(authoritativeThreadCheck(async (threadId) => ({
      threadId, state: 'active', cwd: '/repo',
    }), 'thread')).resolves.toBe('available')
    await expect(authoritativeThreadCheck(async () => {
      throw new Error('thread not found: thread')
    }, 'thread')).resolves.toBe('missing')
    await expect(authoritativeThreadCheck(async () => {
      throw new Error('Codex app-server did not respond within 5s')
    }, 'thread')).resolves.toBe('unchecked')
  })

  it('settles lifecycle authority before reading persisted windows and is a no-op on relaunch', async () => {
    const value = fixture()
    await seed(value.store, [value.task])
    const operation = await value.store.beginLifecycleOperation({
      kind: 'archive', taskId: value.task.id, worktreeId: null, startedAt: 2,
    })
    await value.store.updateLifecycleOperation(operation.id, (candidate) => ({
      ...candidate,
      status: 'needsAttention',
      phase: 'needsAttention',
      rpc: { action: 'archiveThread', status: 'unknown', requestedAt: 2, observedAt: null },
      updatedAt: 2,
      lastError: { code: 'CODEX_RPC_UNKNOWN', message: 'response lost', recordedAt: 2 },
    }))
    const inspectThreadLifecycle = vi.fn(async (threadId: string) => ({
      threadId, state: 'archived' as const, cwd: '/repo',
    }))
    const events: string[] = []
    const dependencies = {
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => {
        events.push('app-state-read')
        expect(value.store.read().lifecycleOperations[0]).toMatchObject({
          status: 'completed', phase: 'archived', rpc: { status: 'observed' },
        })
        return { state: value.state, source: 'primary' as const }
      },
      writeAppState: vi.fn(),
      checkThread: async () => 'available' as const,
      taskRecovery: {
        codex: {
          inspectThreadLifecycle: async (threadId: string) => {
            events.push('thread-inspected')
            return inspectThreadLifecycle(threadId)
          },
          archiveThread: async () => undefined,
          unarchiveThread: async () => ({}),
          deleteThread: async () => undefined,
        },
      },
      now: () => 10,
    }

    const first = await reconcileStartup(dependencies)
    const revision = value.store.read().revision
    const second = await reconcileStartup({ ...dependencies, now: () => 20 })

    expect(events.slice(0, 2)).toEqual(['thread-inspected', 'app-state-read'])
    expect(first.lifecycle).toContainEqual(expect.objectContaining({
      taskId: 'task', kind: 'archive', status: 'repaired', threadState: 'archived',
    }))
    expect(second.lifecycle).toEqual([])
    expect(value.store.read().revision).toBe(revision)
  })

  it('reports a valid binding ready when its thread is confirmed available', async () => {
    const value = fixture()
    await seed(value.store, [value.task])

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
      checkThread: async () => 'available',
    })

    expect(report.windows).toEqual([expect.objectContaining({
      windowId: 'window', status: 'ready', reason: 'none', threadStatus: 'available',
    })])
  })

  it('does not require task thread metadata on a bound tool window', async () => {
    const value = fixture()
    await seed(value.store, [value.task])
    value.state.workspacesByProjectId.project.windows[0] = {
      ...value.state.workspacesByProjectId.project.windows[0],
      type: 'terminal',
      threadId: undefined,
    }

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
    })

    expect(report.windows[0]).toMatchObject({ status: 'ready', reason: 'none' })
  })

  it('restores a missing legacy session target from its matching task', async () => {
    const value = fixture()
    await seed(value.store, [value.task])
    value.state.workspacesByProjectId.project.windows[0] = {
      ...value.state.workspacesByProjectId.project.windows[0],
      type: 'browser',
      threadId: undefined,
      sessionTarget: undefined,
    }
    const writeAppState = vi.fn((state: CranberriAppState) => state)

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
    })

    expect(writeAppState).toHaveBeenCalledWith(expect.objectContaining({
      workspacesByProjectId: expect.objectContaining({
        project: expect.objectContaining({
          windows: [expect.objectContaining({ sessionTarget: 'local', bindingRevision: 4 })],
        }),
      }),
    }))
    expect(report.windows[0]).toMatchObject({ status: 'repaired', reason: 'legacyBindingRestored' })
  })

  it('restores a missing legacy chat thread from its matching task', async () => {
    const value = fixture()
    await seed(value.store, [value.task])
    value.state.workspacesByProjectId.project.windows[0] = {
      ...value.state.workspacesByProjectId.project.windows[0],
      threadId: undefined,
    }
    const writeAppState = vi.fn((state: CranberriAppState) => state)

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
      checkThread: async () => 'available',
    })

    expect(writeAppState).toHaveBeenCalledWith(expect.objectContaining({
      workspacesByProjectId: expect.objectContaining({
        project: expect.objectContaining({
          windows: [expect.objectContaining({ threadId: 'thread', bindingRevision: 4 })],
        }),
      }),
    }))
    expect(report.windows[0]).toMatchObject({ status: 'repaired', reason: 'legacyBindingRestored' })
  })

  it('represents a confirmed missing thread without rebinding the window', async () => {
    const value = fixture()
    await seed(value.store, [value.task])

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
      checkThread: async () => 'missing',
    })

    expect(report.windows[0]).toMatchObject({
      status: 'needsAttention', reason: 'threadMissing', threadStatus: 'missing',
    })
  })

  it('keeps updater health unsettled until persisted threads are checked', async () => {
    const value = fixture()
    await seed(value.store, [value.task])

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
    })

    expect(report.appState.status).toBe('retryable')
    expect(report.windows[0]).toMatchObject({
      status: 'retryable', reason: 'threadUnchecked', threadStatus: 'unchecked',
    })
  })

  it('repairs only a deleted local control binding and persists before reporting it', async () => {
    const value = fixture()
    value.state.workspacesByProjectId.project.windows[0].taskId = 'control-project'
    value.state.workspacesByProjectId.project.windows[0].threadId = undefined
    const events: string[] = []
    let persisted = value.state
    const writeAppState = vi.fn((state: CranberriAppState) => {
      events.push('persisted')
      persisted = state
      expect(state.workspacesByProjectId.project.windows[0]).toMatchObject({
        taskId: null, checkoutId: 'local', sessionTarget: 'local', bindingRevision: 4,
      })
      return state
    })

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
    })
    events.push('reported')
    await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: persisted, source: 'primary' }),
      writeAppState,
    })

    expect(events).toEqual(['persisted', 'reported'])
    expect(writeAppState).toHaveBeenCalledTimes(1)
    expect(report.windows[0]).toMatchObject({ status: 'repaired', reason: 'localControlDeleted' })
  })

  it('repairs a legacy local control binding without a session target', async () => {
    const value = fixture()
    value.state.workspacesByProjectId.project.windows[0] = {
      ...value.state.workspacesByProjectId.project.windows[0],
      taskId: 'control-project',
      threadId: undefined,
      sessionTarget: undefined,
    }
    const writeAppState = vi.fn((state: CranberriAppState) => state)

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
    })

    expect(writeAppState).toHaveBeenCalledWith(expect.objectContaining({
      workspacesByProjectId: expect.objectContaining({
        project: expect.objectContaining({
          windows: [expect.objectContaining({ taskId: null, sessionTarget: 'local' })],
        }),
      }),
    }))
    expect(report.windows[0]).toMatchObject({ status: 'repaired', reason: 'localControlDeleted' })
  })

  it('fails closed for a missing managed worktree and a task ownership mismatch', async () => {
    const value = fixture()
    const missingWorktreeTask: Task = {
      ...value.task, checkoutId: 'managed', worktreeId: 'worktree', location: 'worktree', state: 'active',
    }
    value.state.workspacesByProjectId.project.windows[0] = {
      ...value.state.workspacesByProjectId.project.windows[0], checkoutId: 'managed',
      sessionTarget: 'worktree',
    }
    await seed(value.store, [missingWorktreeTask])

    const missing = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
    })
    expect(missing.windows[0]).toMatchObject({ status: 'needsAttention', reason: 'worktreeMissing' })

    await value.store.update((state) => ({
      ...state,
      tasks: state.tasks.map((task) => ({ ...task, projectId: 'other' })),
    }))
    const mismatch = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
    })
    expect(mismatch.windows[0]).toMatchObject({ status: 'needsAttention', reason: 'taskMismatch' })
  })

  it('keeps corrupt app state unavailable instead of substituting defaults', async () => {
    const value = fixture()
    const writeAppState = vi.fn()

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => { throw new Error('Cannot read app state primary or backup') },
      writeAppState,
    })

    expect(report.appState).toMatchObject({ status: 'needsAttention', source: 'unavailable' })
    expect(report.windows).toEqual([])
    expect(writeAppState).not.toHaveBeenCalled()
  })

  it('returns a typed fail-closed report when the authoritative task store is corrupt', async () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.root, 'tasks.json'), 'not-json')

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
    })

    expect(report).toMatchObject({
      appState: { status: 'ready', source: 'primary' },
      taskStore: { status: 'needsAttention', revision: 0, repairedTaskIds: [] },
      windows: [],
    })
  })

  it('runs explicit retry against the configured runtime TaskStore instance', async () => {
    const value = fixture()
    await seed(value.store, [{ ...value.task, state: 'provisioning' }])
    const restore = configureStartupRecoveryRuntime({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
      checkThread: async () => 'available',
      now: () => 10,
    })

    try {
      await retryStartupRecovery()
      expect(value.store.read().tasks[0]).toMatchObject({ state: 'draft', updatedAt: 10 })
    } finally {
      restore()
    }
  })

  it('delegates interrupted handoff recovery before explicit runtime reconciliation', async () => {
    const value = fixture()
    await seed(value.store, [{
      ...value.task,
      state: 'handingOff',
      handoff: {
        direction: 'toLocal', phase: 'captured', branch: 'feature', bundlePath: '/bundle',
        startedAt: 1, error: null,
      },
    }])
    const recoverHandoff = vi.fn(async (taskId: string) => {
      await value.store.update((state) => ({
        ...state,
        tasks: state.tasks.map((task) => task.id === taskId
          ? { ...task, state: 'active' as const, handoff: null, updatedAt: 10 }
          : task),
      }))
    })
    const restore = configureStartupRecoveryRuntime({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: vi.fn(),
      checkThread: async () => 'available',
      recoverHandoff,
      now: () => 10,
    })

    try {
      await retryStartupRecovery()
      expect(recoverHandoff).toHaveBeenCalledWith('task')
      expect(getStartupHandoffRecoveries()).toEqual([])
      expect(value.store.read().tasks[0]).toMatchObject({ state: 'active', handoff: null, updatedAt: 10 })
    } finally {
      restore()
    }
  })

  it('makes interrupted work observable and is mutation-idempotent on rerun', async () => {
    const value = fixture()
    await seed(value.store, [{
      ...value.task,
      state: 'handingOff',
      handoff: {
        direction: 'toLocal', phase: 'captured', branch: 'feature', bundlePath: '/bundle',
        startedAt: 1, error: null,
      },
    }])
    const writeAppState = vi.fn((state: CranberriAppState) => state)

    const first = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
      now: () => 10,
    })
    const firstRevision = value.store.read().revision
    const second = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState,
      now: () => 20,
    })

    expect(first.windows[0]).toMatchObject({ status: 'retryable', reason: 'interruptedOperation' })
    expect(second.windows[0]).toMatchObject({ status: 'retryable', reason: 'interruptedOperation' })
    expect(value.store.read().tasks[0].handoff).toMatchObject({ phase: 'captured' })
    expect(value.store.read().revision).toBe(firstRevision)
    expect(writeAppState).not.toHaveBeenCalled()
  })

  it('persists interrupted first-turn thread cleanup before offering retry', async () => {
    const value = fixture()
    await seed(value.store, [{
      ...value.task,
      pendingFirstTurn: {
        payload: { input: [{ type: 'text', text: 'retry me' }] },
        delivery: 'pending',
      },
    }])
    const persisted: CranberriAppState[] = []

    const report = await reconcileStartup({
      taskStore: value.store,
      readProjectRegistry: () => value.registry,
      readAppState: () => ({ state: value.state, source: 'primary' }),
      writeAppState: (state) => {
        persisted.push(state)
        return state
      },
      now: () => 10,
    })

    expect(persisted).toHaveLength(1)
    expect(persisted[0].workspacesByProjectId.project.windows[0]).toMatchObject({
      bindingRevision: 4,
    })
    expect(persisted[0].workspacesByProjectId.project.windows[0].threadId).toBeUndefined()
    expect(report.windows[0]).toMatchObject({ status: 'retryable', reason: 'interruptedOperation' })
  })
})
