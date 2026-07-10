import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExecFileException } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ToolCatalogId,
  ToolCatalogProbeResult,
  ToolCatalogTaskKey,
} from '../shared/tools'
import {
  CATALOG_PROBE_POLICIES,
  ToolCatalogService,
  isTrustedCatalogIpcSender,
  resolveCatalogExecutable,
  runAllowlistedCatalogProbe,
  type CatalogExecFile,
  type CatalogProbeObservation,
  type ToolCatalogRequestContext,
} from './tool-catalog-service'
import { DEFAULT_TOOL_CATALOG_DESCRIPTORS } from './tool-catalog'

const START_MS = Date.parse('2026-07-09T20:00:00.000Z')
const TASK: ToolCatalogTaskKey = { threadId: 'thread-1', capabilityEpoch: 'local-1' }
const CONTEXT: ToolCatalogRequestContext = {
  taskKey: TASK,
  preferences: { pinnedToolIds: [], dismissedDefaultToolIds: [] },
  registryEvidence: [],
}

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

function success(version: string): CatalogProbeObservation {
  return {
    status: 'installed',
    version,
    diagnosticCode: null,
    safeOutput: version,
  }
}

function catalogEntry(snapshot: Awaited<ReturnType<ToolCatalogService['list']>>, id: string) {
  const entry = snapshot.entries.find((candidate) => candidate.id === id)
  expect(entry, `missing catalog entry ${id}`).toBeDefined()
  return entry!
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('ToolCatalogService cache', () => {
  it('keeps every probe-capable CLI descriptor aligned with one policy', () => {
    const descriptorIds = DEFAULT_TOOL_CATALOG_DESCRIPTORS
      .filter((entry) => entry.source.kind === 'cli' && entry.probeCapability.kind !== 'unsupported')
      .map((entry) => entry.id)
      .sort()
    const policyIds = CATALOG_PROBE_POLICIES.map((policy) => policy.catalogId).sort()

    expect(policyIds).toEqual(descriptorIds)
    expect(new Set(policyIds).size).toBe(policyIds.length)
  })

  it('shares environment discovery across a full refresh and keeps manual tests fresh', async () => {
    const environment = vi.fn(async () => ({ PATH: '/usr/bin', HOME: '/Users/example' }))
    const projectRoots = vi.fn(() => ['/workspace/repo'])
    const resolveExecutable = vi.fn(async (name: string) => ({ path: `/usr/bin/${name}`, errorCode: null }))
    const execFile: CatalogExecFile = (_file, _argv, _options, callback) => {
      callback(null, 'tool version 1.0.0', '')
      return { kill: vi.fn(() => true) }
    }
    const service = new ToolCatalogService({
      now: () => START_MS,
      environment,
      projectRoots,
      resolveExecutable,
      execFile,
      neutralCwd: '/tmp',
    })

    await service.list(CONTEXT)
    expect(environment).toHaveBeenCalledTimes(1)
    expect(projectRoots).toHaveBeenCalledTimes(1)
    expect(resolveExecutable).toHaveBeenCalledTimes(CATALOG_PROBE_POLICIES.length)

    await service.test('cli:rg', CONTEXT)
    expect(environment).toHaveBeenCalledTimes(2)
    expect(projectRoots).toHaveBeenCalledTimes(2)
  })

  it('returns a fresh cache hit and coalesces one stale full refresh', async () => {
    let now = START_MS
    const blocked = deferred<CatalogProbeObservation>()
    let blockRefresh = false
    const probeRunner = vi.fn(async (): Promise<CatalogProbeObservation> => {
      if (blockRefresh) return blocked.promise
      return success('1.0.0')
    })
    const service = new ToolCatalogService({
      now: () => now,
      freshnessMs: 1_000,
      probeRunner,
    })

    await service.list(CONTEXT)
    const initialCalls = probeRunner.mock.calls.length
    await service.list(CONTEXT)
    expect(probeRunner).toHaveBeenCalledTimes(initialCalls)

    now += 1_001
    blockRefresh = true
    const first = service.list(CONTEXT)
    const second = service.list(CONTEXT)
    await vi.waitFor(() => expect(probeRunner.mock.calls.length).toBeGreaterThan(initialCalls))
    expect(probeRunner).toHaveBeenCalledTimes(initialCalls + CATALOG_PROBE_POLICIES.length)

    blocked.resolve(success('1.1.0'))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(probeRunner).toHaveBeenCalledTimes(initialCalls + CATALOG_PROBE_POLICIES.length)
  })

  it('bypasses freshness for forced refresh and changes only one entry for an individual test', async () => {
    let sequence = 0
    const probeRunner = vi.fn(async (policy): Promise<CatalogProbeObservation> => {
      sequence += 1
      return success(`${policy.executableName}-${sequence}`)
    })
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })
    const initial = await service.list(CONTEXT)
    const rgBefore = catalogEntry(initial, 'cli:rg').machine.observedAt

    await service.refresh(CONTEXT)
    expect(probeRunner).toHaveBeenCalledTimes(CATALOG_PROBE_POLICIES.length * 2)

    probeRunner.mockClear()
    const beforeTest = await service.list(CONTEXT)
    const gitBefore = catalogEntry(beforeTest, 'cli:git').machine
    const tested = await service.test('cli:rg', CONTEXT)

    expect(probeRunner).toHaveBeenCalledTimes(1)
    expect(probeRunner.mock.calls[0]?.[0]).toMatchObject({ catalogId: 'cli:rg' })
    expect(catalogEntry(tested, 'cli:rg').machine.observedAt).not.toBe(rgBefore)
    expect(catalogEntry(tested, 'cli:git').machine).toEqual(gitBefore)
  })

  it('keeps a newer individual result when an older full refresh finishes later', async () => {
    const oldRg = deferred<CatalogProbeObservation>()
    let blockOldRg = true
    const probeRunner = vi.fn(async (policy, mode): Promise<CatalogProbeObservation> => {
      if (policy.catalogId === 'cli:rg' && mode === 'automatic' && blockOldRg) {
        blockOldRg = false
        return oldRg.promise
      }
      if (policy.catalogId === 'cli:rg' && mode === 'manual') return success('15.0.0')
      return success('1.0.0')
    })
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })

    const refresh = service.refresh(CONTEXT)
    await vi.waitFor(() => expect(probeRunner).toHaveBeenCalledWith(
      expect.objectContaining({ catalogId: 'cli:rg' }),
      'automatic',
      expect.any(AbortSignal),
    ))
    const individual = await service.test('cli:rg', CONTEXT)
    oldRg.resolve(success('13.0.0'))
    await refresh
    const final = await service.list(CONTEXT)

    expect(catalogEntry(individual, 'cli:rg').machine.version).toBe('15.0.0')
    expect(catalogEntry(final, 'cli:rg').machine.version).toBe('15.0.0')
  })

  it('lets a forced refresh supersede an older full refresh', async () => {
    const oldResult = deferred<CatalogProbeObservation>()
    let blockOldRefresh = true
    const probeRunner = vi.fn(async (): Promise<CatalogProbeObservation> => (
      blockOldRefresh ? oldResult.promise : success('2.0.0')
    ))
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })

    const oldRefresh = service.refresh(CONTEXT)
    await vi.waitFor(() => expect(probeRunner).toHaveBeenCalledTimes(CATALOG_PROBE_POLICIES.length))
    blockOldRefresh = false
    const forcedRefresh = service.refresh(CONTEXT)
    await expect(forcedRefresh).resolves.toBeDefined()
    expect(probeRunner).toHaveBeenCalledTimes(CATALOG_PROBE_POLICIES.length * 2)

    oldResult.resolve(success('1.0.0'))
    await oldRefresh
    const final = await service.list(CONTEXT)
    expect(catalogEntry(final, 'cli:rg').machine.version).toBe('2.0.0')
  })

  it('preserves manual authentication evidence across automatic version checks', async () => {
    let authenticated = false
    const probeRunner = vi.fn(async (_policy, mode): Promise<CatalogProbeObservation> => {
      if (mode === 'manual' && !authenticated) {
        return {
          status: 'authentication-required',
          version: '2.80.0',
          diagnosticCode: 'authentication-required',
          safeOutput: '',
        }
      }
      return success('2.80.0')
    })
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })

    const signedOut = await service.test('cli:gh', CONTEXT)
    expect(catalogEntry(signedOut, 'cli:gh').machine.status).toBe('authentication-required')
    const refreshed = await service.refresh(CONTEXT)
    expect(catalogEntry(refreshed, 'cli:gh').machine.status).toBe('authentication-required')

    authenticated = true
    const signedIn = await service.test('cli:gh', CONTEXT)
    expect(catalogEntry(signedIn, 'cli:gh').machine.status).toBe('installed')
  })

  it('preserves the last good entry as stale when a later refresh times out', async () => {
    let shouldTimeout = false
    const probeRunner = vi.fn(async (policy): Promise<CatalogProbeObservation> => {
      if (shouldTimeout && policy.catalogId === 'cli:rg') {
        return { failureCode: 'probe-timeout', safeOutput: '' }
      }
      return success(policy.catalogId === 'cli:rg' ? '14.1.0' : '1.0.0')
    })
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })

    await service.list(CONTEXT)
    shouldTimeout = true
    const stale = await service.refresh(CONTEXT)

    expect(stale.refresh).toMatchObject({ status: 'stale', errorCode: 'probe-timeout' })
    expect(catalogEntry(stale, 'cli:rg').machine).toMatchObject({
      status: 'installed',
      version: '14.1.0',
      stale: true,
      provenance: 'last-good',
      diagnosticCode: 'probe-timeout',
    })
    expect(catalogEntry(stale, 'cli:git').machine).toMatchObject({
      status: 'installed',
      stale: false,
      provenance: 'local-probe',
      diagnosticCode: null,
    })
  })

  it('rejects arbitrary IDs before any process boundary is reached', async () => {
    const probeRunner = vi.fn(async () => success('1.0.0'))
    const service = new ToolCatalogService({ now: () => START_MS, probeRunner })

    await expect(service.test('cli:rm' as ToolCatalogId, CONTEXT)).rejects.toThrow('not allowlisted')
    await expect(service.test('codex:exec_command' as ToolCatalogId, CONTEXT)).rejects.toThrow('not allowlisted')
    expect(probeRunner).not.toHaveBeenCalled()
  })
})

describe('allowlisted CLI process boundary', () => {
  it('uses a fixed absolute executable without a shell or inherited secrets and bounds/redacts capture', async () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    const execFile: CatalogExecFile = vi.fn((_file, _argv, _options, callback) => {
      callback(null, `ripgrep 14.1.0\nGH_TOKEN=${secret}\n${'x'.repeat(20_000)}`, '')
      return { kill: vi.fn(() => true) }
    })

    const observation = await runAllowlistedCatalogProbe(
      CATALOG_PROBE_POLICIES.find((policy) => policy.catalogId === 'cli:rg')!,
      'automatic',
      new AbortController().signal,
      {
        environment: async () => ({
          PATH: '/trusted/bin:/usr/bin',
          HOME: '/Users/example',
          GH_TOKEN: secret,
          OPENAI_API_KEY: 'sk-should-not-cross',
        }),
        projectRoots: () => ['/workspace/repo'],
        resolveExecutable: async () => ({ path: '/trusted/bin/rg', errorCode: null }),
        execFile,
        neutralCwd: '/tmp',
      },
    )

    expect(observation).toMatchObject({ status: 'installed', version: '14.1.0' })
    expect(observation.safeOutput.length).toBeLessThanOrEqual(4_096)
    expect(observation.safeOutput).not.toContain(secret)
    expect(observation.safeOutput).toContain('[redacted]')
    expect(execFile).toHaveBeenCalledTimes(1)
    const [file, argv, options] = vi.mocked(execFile).mock.calls[0]!
    expect(file).toBe('/trusted/bin/rg')
    expect(argv).toEqual(['--version'])
    expect(options).toMatchObject({
      cwd: '/tmp',
      shell: false,
      timeout: 3_000,
      maxBuffer: 16_384,
    })
    expect(options.env).toMatchObject({ PATH: '/trusted/bin:/usr/bin', HOME: '/Users/example' })
    expect(options.env).not.toHaveProperty('GH_TOKEN')
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('maps a hung process to a timeout without retaining captured secrets', async () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz'
    const execFile: CatalogExecFile = (_file, _argv, _options, callback) => {
      const error = Object.assign(new Error('timed out'), {
        killed: true,
        signal: 'SIGTERM' as NodeJS.Signals,
      }) as ExecFileException
      callback(error, `TOKEN=${secret}`, '')
      return { kill: vi.fn(() => true) }
    }

    const observation = await runAllowlistedCatalogProbe(
      CATALOG_PROBE_POLICIES.find((policy) => policy.catalogId === 'cli:git')!,
      'automatic',
      new AbortController().signal,
      {
        environment: async () => ({ PATH: '/usr/bin' }),
        projectRoots: () => [],
        resolveExecutable: async () => ({ path: '/usr/bin/git', errorCode: null }),
        execFile,
        neutralCwd: '/tmp',
      },
    )

    expect(observation).toMatchObject({ failureCode: 'probe-timeout' })
    expect(observation.safeOutput).toBe('TOKEN=[redacted]')
    expect(observation.safeOutput).not.toContain(secret)
  })

  it('runs gh authentication only for a manual test and reports signed-out state', async () => {
    const calls: string[][] = []
    const execFile: CatalogExecFile = (file, argv, options, callback) => {
      expect(path.isAbsolute(file)).toBe(true)
      expect(options.shell).toBe(false)
      calls.push(argv)
      if (argv[0] === 'auth') {
        callback(Object.assign(new Error('not logged in'), { code: 1 }), '', 'not logged in to any hosts')
      } else {
        callback(null, 'gh version 2.80.0', '')
      }
      return { kill: vi.fn(() => true) }
    }
    const dependencies = {
      environment: async () => ({ PATH: '/usr/local/bin:/usr/bin', HOME: '/Users/example' }),
      projectRoots: () => [],
      resolveExecutable: async () => ({ path: '/usr/local/bin/gh', errorCode: null }),
      execFile,
      neutralCwd: '/tmp',
    }
    const policy = CATALOG_PROBE_POLICIES.find((candidate) => candidate.catalogId === 'cli:gh')!

    const automatic = await runAllowlistedCatalogProbe(
      policy,
      'automatic',
      new AbortController().signal,
      dependencies,
    )
    expect(automatic).toMatchObject({ status: 'installed', version: '2.80.0' })
    expect(calls).toEqual([['--version']])

    calls.length = 0
    const manual = await runAllowlistedCatalogProbe(
      policy,
      'manual',
      new AbortController().signal,
      dependencies,
    )
    expect(manual).toMatchObject({
      status: 'authentication-required',
      version: '2.80.0',
      diagnosticCode: 'authentication-required',
    })
    expect(calls).toEqual([['--version'], ['auth', 'status']])
  })

  it('rejects relative PATH entries and project-local executable shadowing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cranberri-probe-project-'))
    tempDirs.push(projectRoot)
    const projectBin = path.join(projectRoot, 'node_modules', '.bin')
    await fs.mkdir(projectBin, { recursive: true })
    const shadowedRg = path.join(projectBin, 'rg')
    await fs.writeFile(shadowedRg, '#!/bin/sh\nexit 0\n')
    await fs.chmod(shadowedRg, 0o755)

    await expect(resolveCatalogExecutable('rg', {
      PATH: `node_modules/.bin${path.delimiter}/usr/bin`,
    }, [projectRoot])).resolves.toEqual({
      path: null,
      errorCode: 'untrusted-path-entry',
    })
    await expect(resolveCatalogExecutable('rg', {
      PATH: `${projectBin}${path.delimiter}/usr/bin`,
    }, [projectRoot])).resolves.toEqual({
      path: null,
      errorCode: 'project-local-executable',
    })
  })

  it('rejects executables beneath temporary path roots', async () => {
    if (process.platform === 'win32') return
    const shadowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cranberri-probe-shadow-'))
    tempDirs.push(shadowDir)
    const shadowedRg = path.join(shadowDir, 'rg')
    await fs.writeFile(shadowedRg, '#!/bin/sh\nexit 0\n')
    await fs.chmod(shadowedRg, 0o755)

    await expect(resolveCatalogExecutable('rg', {
      PATH: `${shadowDir}${path.delimiter}/usr/bin`,
    }, ['/workspace/repo'])).resolves.toEqual({
      path: null,
      errorCode: 'untrusted-temporary-path',
    })
  })

  it('rejects executables beneath group or world-writable path ancestors', async () => {
    if (process.platform === 'win32') return
    const shadowDir = await fs.mkdtemp(path.join(path.dirname(process.cwd()), '.cranberri-probe-shadow-'))
    tempDirs.push(shadowDir)
    const shadowedRg = path.join(shadowDir, 'rg')
    await fs.writeFile(shadowedRg, '#!/bin/sh\nexit 0\n')
    await fs.chmod(shadowedRg, 0o755)
    await fs.chmod(shadowDir, 0o777)

    await expect(resolveCatalogExecutable('rg', {
      PATH: `${shadowDir}${path.delimiter}/usr/bin`,
    }, ['/workspace/repo'])).resolves.toEqual({
      path: null,
      errorCode: 'untrusted-path-permissions',
    })
  })
})

describe('catalog IPC sender authorization', () => {
  it('accepts only the main Cranberri frame at the configured entry URL', () => {
    const mainFrame = { url: 'http://localhost:5173/' }
    const webContents = {
      id: 1,
      mainFrame,
      isDestroyed: () => false,
      getURL: () => mainFrame.url,
    }
    const mainWindow = { isDestroyed: () => false, webContents }

    expect(isTrustedCatalogIpcSender(
      { sender: webContents, senderFrame: mainFrame },
      mainWindow,
      'http://localhost:5173/',
    )).toBe(true)
    expect(isTrustedCatalogIpcSender(
      { sender: { id: 2 }, senderFrame: mainFrame },
      mainWindow,
      'http://localhost:5173/',
    )).toBe(false)
    expect(isTrustedCatalogIpcSender(
      { sender: webContents, senderFrame: { url: mainFrame.url } },
      mainWindow,
      'http://localhost:5173/',
    )).toBe(false)

    mainFrame.url = 'https://example.com/'
    expect(isTrustedCatalogIpcSender(
      { sender: webContents, senderFrame: mainFrame },
      mainWindow,
      'http://localhost:5173/',
    )).toBe(false)
  })
})

describe('probe result shape', () => {
  it('keeps service observations compatible with the shared probe contract', async () => {
    const service = new ToolCatalogService({
      now: () => START_MS,
      probeRunner: async () => success('14.1.0'),
    })
    const snapshot = await service.test('cli:rg', { ...CONTEXT, taskKey: null })
    const entry = catalogEntry(snapshot, 'cli:rg')
    const result: ToolCatalogProbeResult = {
      catalogId: entry.id,
      status: entry.machine.status,
      version: entry.machine.version,
      observedAt: entry.machine.observedAt!,
      diagnosticCode: entry.machine.diagnosticCode,
    }

    expect(result).toMatchObject({ catalogId: 'cli:rg', status: 'installed', version: '14.1.0' })
    expect(entry.task).toMatchObject({ status: 'no-active-task', taskKey: null })
  })
})
