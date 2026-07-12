import { beforeEach, describe, expect, it, vi } from 'vitest'

const codex = vi.hoisted(() => ({
  getClient: vi.fn(),
  readThread: vi.fn(),
}))

vi.mock('./codex/ipc', () => ({ getCodexClient: codex.getClient }))
vi.mock('./environments/runner', () => ({ EnvironmentRunner: class EnvironmentRunner {} }))
vi.mock('./environments/store', () => ({ EnvironmentStore: class EnvironmentStore {} }))
vi.mock('./task-store', () => ({ TaskStore: class TaskStore {} }))
vi.mock('./tasks', () => ({ TaskCoordinator: class TaskCoordinator {} }))
vi.mock('./worktree-lifecycle', () => ({
  WorktreeLifecycle: class WorktreeLifecycle {
    sweepRetention = vi.fn()
  },
}))
vi.mock('./settings', () => ({ readSettings: () => ({ worktrees: { retentionDays: 7 } }) }))

import { checkStartupThread } from './worktree-runtime'

describe('startup runtime thread authority', () => {
  beforeEach(() => {
    codex.readThread.mockReset()
    codex.getClient.mockReset()
    codex.getClient.mockResolvedValue({ readThread: codex.readThread })
  })

  it('checks a persisted thread through the initialized Codex app-server client', async () => {
    codex.readThread.mockResolvedValue({ id: 'thread' })

    await expect(checkStartupThread('thread')).resolves.toBe('available')

    expect(codex.getClient).toHaveBeenCalledOnce()
    expect(codex.readThread).toHaveBeenCalledWith('thread')
    expect(codex.getClient.mock.invocationCallOrder[0]).toBeLessThan(
      codex.readThread.mock.invocationCallOrder[0],
    )
  })

  it('fails closed when app-server initialization is unavailable', async () => {
    codex.getClient.mockRejectedValue(new Error('Codex app-server failed to initialize'))

    await expect(checkStartupThread('thread')).resolves.toBe('unchecked')
    expect(codex.readThread).not.toHaveBeenCalled()
  })
})
