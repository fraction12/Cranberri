import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartupRecoveryReport } from '../shared/recovery'

const codex = vi.hoisted(() => ({
  getClient: vi.fn(),
  inspectThreadLifecycle: vi.fn(),
}))

vi.mock('./codex/ipc', () => ({ getCodexClient: codex.getClient }))
vi.mock('./environments/runner', () => ({ EnvironmentRunner: class EnvironmentRunner {} }))
vi.mock('./environments/store', () => ({ EnvironmentStore: class EnvironmentStore {} }))
vi.mock('./task-store', () => ({ TaskStore: class TaskStore {} }))
vi.mock('./tasks', () => ({ TaskCoordinator: class TaskCoordinator {} }))
vi.mock('./worktree-lifecycle', () => ({
  WorktreeLifecycle: class WorktreeLifecycle {},
}))

import { checkStartupThread, settleStartupMaintenance } from './worktree-runtime'

const READY_REPORT: StartupRecoveryReport = {
  appState: { status: 'ready', source: 'primary', message: 'App state is available.' },
  taskStore: { status: 'ready', revision: 1, repairedTaskIds: [] },
  windows: [],
}

describe('startup runtime thread authority', () => {
  beforeEach(() => {
    codex.inspectThreadLifecycle.mockReset()
    codex.getClient.mockReset()
    codex.getClient.mockResolvedValue({ inspectThreadLifecycle: codex.inspectThreadLifecycle })
  })

  it('checks a persisted thread through the initialized Codex app-server client', async () => {
    codex.inspectThreadLifecycle.mockResolvedValue({ threadId: 'thread', state: 'archived', cwd: '/repo' })

    await expect(checkStartupThread('thread')).resolves.toBe('available')

    expect(codex.getClient).toHaveBeenCalledOnce()
    expect(codex.inspectThreadLifecycle).toHaveBeenCalledWith('thread')
    expect(codex.getClient.mock.invocationCallOrder[0]).toBeLessThan(
      codex.inspectThreadLifecycle.mock.invocationCallOrder[0],
    )
  })

  it('classifies an authoritative missing lifecycle inspection as missing', async () => {
    codex.inspectThreadLifecycle.mockResolvedValue({ threadId: 'thread', state: 'missing', cwd: null })

    await expect(checkStartupThread('thread')).resolves.toBe('missing')
  })

  it('fails closed when app-server initialization is unavailable', async () => {
    codex.getClient.mockRejectedValue(new Error('Codex app-server failed to initialize'))

    await expect(checkStartupThread('thread')).resolves.toBe('unchecked')
    expect(codex.inspectThreadLifecycle).not.toHaveBeenCalled()
  })

  it('keeps startup reachable when lifecycle maintenance cannot read the task store', async () => {
    const result = await settleStartupMaintenance(READY_REPORT, async () => {
      throw new Error('Cannot read task store')
    })

    expect(result.taskStore).toMatchObject({
      status: 'needsAttention', message: 'Cannot read task store',
    })
  })
})
