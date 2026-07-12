import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
    quit: vi.fn(),
  },
  BrowserWindow: class {
    static getAllWindows(): unknown[] { return [] }
  },
  ipcMain: { handle: vi.fn() },
  nativeTheme: { shouldUseDarkColors: true, on: vi.fn(), removeListener: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

vi.mock('electron', () => electron)
vi.mock('./appIpc', () => ({ initAppIpc: vi.fn() }))
vi.mock('./repos', () => ({ initRepoIpc: vi.fn() }))
vi.mock('./git', () => ({ initGitIpc: vi.fn() }))
vi.mock('./github', () => ({ initGitHubIpc: vi.fn() }))
vi.mock('./codex/ipc', () => ({ initCodexIpc: vi.fn(), stopCodexClient: vi.fn() }))
vi.mock('./worktree-runtime', () => ({ recoverStartupRuntime: vi.fn() }))
vi.mock('./settings', () => ({ initSettingsIpc: vi.fn() }))
vi.mock('./terminal', () => ({ initTerminalIpc: vi.fn(), killAllTerminals: vi.fn() }))
vi.mock('./processes', () => ({ initProcessesIpc: vi.fn() }))
vi.mock('./health', () => ({ initHealthIpc: vi.fn() }))
vi.mock('./appState', () => ({ initAppStateIpc: vi.fn() }))
vi.mock('./composer-drafts', () => ({ initComposerDraftsIpc: vi.fn() }))
vi.mock('./telemetry', () => ({ initTelemetryIpc: vi.fn() }))
vi.mock('./updater', () => ({ initUpdaterIpc: vi.fn() }))
vi.mock('./search', () => ({ initSearchIpc: vi.fn() }))
vi.mock('./browser', () => ({ initBrowserIpc: vi.fn() }))
vi.mock('./environments/ipc', () => ({ initEnvironmentIpc: vi.fn() }))
vi.mock('./startup-recovery', () => ({ initStartupRecoveryIpc: vi.fn() }))

import { RendererPersistenceFlushCoordinator } from './index'

describe('RendererPersistenceFlushCoordinator', () => {
  it('keeps close pending until the matching renderer acknowledgement arrives', async () => {
    const coordinator = new RendererPersistenceFlushCoordinator(1_000)
    const send = vi.fn()
    const pending = coordinator.request({ isDestroyed: () => false, send }, 'window-close')
    const request = send.mock.calls[0]?.[1]

    expect(request).toMatchObject({ reason: 'window-close' })
    expect(coordinator.acknowledge({ requestId: 'not-the-request', errorMessage: null })).toEqual({ ok: false })
    coordinator.acknowledge({ requestId: request.requestId, errorMessage: null })

    await expect(pending).resolves.toBeUndefined()
  })

  it('blocks close when the renderer reports a failed durable write', async () => {
    const coordinator = new RendererPersistenceFlushCoordinator(1_000)
    const send = vi.fn()
    const pending = coordinator.request({ isDestroyed: () => false, send }, 'app-quit')
    const request = send.mock.calls[0]?.[1]

    coordinator.acknowledge({ requestId: request.requestId, errorMessage: 'draft write failed' })

    await expect(pending).rejects.toThrow('draft write failed')
  })
})
