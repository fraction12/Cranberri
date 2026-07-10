import { execFile, type ExecFileException } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  toolCatalogIdSchema,
  toolCatalogProbeResultSchema,
  type ToolCatalogId,
  type ToolCatalogMachineStatus,
  type ToolCatalogPreferences,
  type ToolCatalogProbeResult,
  type ToolCatalogRefreshFailure,
  type ToolCatalogRegistryEvidence,
  type ToolCatalogSnapshot,
  type ToolCatalogTaskKey,
} from '../shared/tools'
import { makeCodexEnv } from './codex/env'
import { assembleToolCatalog } from './tool-catalog'

const DEFAULT_FRESHNESS_MS = 30_000
const PROBE_TIMEOUT_MS = 3_000
const PROBE_MAX_BUFFER_BYTES = 16_384
const SAFE_CAPTURE_CHARS = 4_096

export type CatalogProbeMode = 'automatic' | 'manual'

export interface CatalogProbePolicy {
  catalogId: ToolCatalogId
  executableName: string
  versionArgv: readonly string[]
  manualArgv?: readonly string[]
  manualResult?: 'authentication'
}

export const CATALOG_PROBE_POLICIES: readonly CatalogProbePolicy[] = [
  { catalogId: 'cli:rg', executableName: 'rg', versionArgv: ['--version'] },
  { catalogId: 'cli:grep', executableName: 'grep', versionArgv: ['--version'] },
  { catalogId: 'cli:find', executableName: 'find', versionArgv: ['--version'] },
  { catalogId: 'cli:git', executableName: 'git', versionArgv: ['--version'] },
  {
    catalogId: 'cli:gh',
    executableName: 'gh',
    versionArgv: ['--version'],
    manualArgv: ['auth', 'status'],
    manualResult: 'authentication',
  },
  { catalogId: 'cli:node', executableName: 'node', versionArgv: ['--version'] },
  { catalogId: 'cli:npm', executableName: 'npm', versionArgv: ['--version'] },
  { catalogId: 'cli:npx', executableName: 'npx', versionArgv: ['--version'] },
  { catalogId: 'cli:python3', executableName: 'python3', versionArgv: ['--version'] },
  { catalogId: 'cli:pip', executableName: 'pip', versionArgv: ['--version'] },
  { catalogId: 'cli:jq', executableName: 'jq', versionArgv: ['--version'] },
  { catalogId: 'cli:curl', executableName: 'curl', versionArgv: ['--version'] },
]

const POLICY_BY_ID = new Map(CATALOG_PROBE_POLICIES.map((policy) => [policy.catalogId, policy]))

export interface ToolCatalogRequestContext {
  taskKey: ToolCatalogTaskKey | null
  preferences: ToolCatalogPreferences
  registryEvidence: ToolCatalogRegistryEvidence[]
}

export interface CatalogProbeObservation {
  status?: ToolCatalogMachineStatus
  version?: string | null
  diagnosticCode?: string | null
  failureCode?: string
  safeOutput: string
}

export interface CatalogExecFileOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeout: number
  maxBuffer: number
  windowsHide: true
  shell: false
  encoding: BufferEncoding
}

export interface CatalogExecChild {
  kill: (signal?: NodeJS.Signals | number) => boolean
}

export type CatalogExecFile = (
  executable: string,
  argv: string[],
  options: CatalogExecFileOptions,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => CatalogExecChild

interface CatalogProcessCapture {
  exitCode: number | null
  failureCode: string | null
  safeOutput: string
}

export interface CatalogExecutableResolution {
  path: string | null
  errorCode: string | null
}

export interface CatalogProbeRuntimeDependencies {
  environment?: () => Promise<NodeJS.ProcessEnv>
  projectRoots?: () => string[]
  resolveExecutable?: (
    executableName: string,
    environment: NodeJS.ProcessEnv,
    projectRoots: string[],
  ) => Promise<CatalogExecutableResolution>
  execFile?: CatalogExecFile
  neutralCwd?: string
}

export type CatalogProbeRunner = (
  policy: CatalogProbePolicy,
  mode: CatalogProbeMode,
  signal: AbortSignal,
) => Promise<CatalogProbeObservation>

export interface ToolCatalogServiceOptions extends CatalogProbeRuntimeDependencies {
  freshnessMs?: number
  now?: () => number
  probeRunner?: CatalogProbeRunner
}

interface CachedProbeResult {
  generation: number
  result: ToolCatalogProbeResult
}

interface CachedProbeFailure {
  generation: number
  failure: ToolCatalogRefreshFailure
}

const defaultExecFile: CatalogExecFile = (executable, argv, options, callback) => (
  execFile(executable, argv, options, callback) as CatalogExecChild
)

function boundSafeOutput(value: string): string {
  if (value.length <= SAFE_CAPTURE_CHARS) return value
  const marker = '\n[output truncated]'
  return `${value.slice(0, SAFE_CAPTURE_CHARS - marker.length)}${marker}`
}

export function redactCatalogProbeOutput(value: string): string {
  const redacted = value
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(
      /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|API_?KEY|CREDENTIAL)[A-Z0-9_]*))\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[redacted]',
    )
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/:\/\/[^\s/:@]+:[^\s/@]+@/g, '://[redacted]@')
  return boundSafeOutput(redacted.trim())
}

function sameOrDescendant(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function executableCandidates(directory: string, executableName: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (process.platform !== 'win32') return [path.join(directory, executableName)]
  const extensions = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  if (path.extname(executableName)) return [path.join(directory, executableName)]
  return extensions.map((extension) => path.join(directory, `${executableName}${extension.toLowerCase()}`))
}

export async function resolveCatalogExecutable(
  executableName: string,
  env: NodeJS.ProcessEnv,
  projectRoots: string[],
): Promise<CatalogExecutableResolution> {
  if (!/^[A-Za-z0-9._+-]+$/.test(executableName)) {
    return { path: null, errorCode: 'untrusted-executable-name' }
  }

  const pathEntries = env.PATH?.split(path.delimiter) ?? []
  for (const pathEntry of pathEntries) {
    if (!pathEntry || !path.isAbsolute(pathEntry)) {
      return { path: null, errorCode: 'untrusted-path-entry' }
    }

    const candidates = await executableCandidates(pathEntry, executableName, env)
    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fs.constants.X_OK)
        const stats = await fs.stat(candidate)
        if (!stats.isFile()) continue
        const realCandidate = await fs.realpath(candidate)
        if (!path.isAbsolute(realCandidate)) {
          return { path: null, errorCode: 'untrusted-executable-path' }
        }
        if (projectRoots.some((root) => sameOrDescendant(candidate, root) || sameOrDescendant(realCandidate, root))) {
          return { path: null, errorCode: 'project-local-executable' }
        }
        return { path: realCandidate, errorCode: null }
      } catch {
        // Continue through the trusted PATH in launch order.
      }
    }
  }

  return { path: null, errorCode: 'executable-not-found' }
}

function minimalProbeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowedKeys = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'XDG_CONFIG_HOME',
    'SystemRoot',
    'PATHEXT',
  ]
  const minimal: NodeJS.ProcessEnv = {
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
  for (const key of allowedKeys) {
    if (env[key]) minimal[key] = env[key]
  }
  return minimal
}

function processFailureCode(error: ExecFileException | null, signal: AbortSignal): string | null {
  if (signal.aborted) return 'probe-cancelled'
  if (!error || typeof error.code === 'number') return null
  if (error.killed || error.signal === 'SIGTERM' || /timed?\s*out/i.test(error.message)) return 'probe-timeout'
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(error.message)) {
    return 'probe-output-limit'
  }
  return 'probe-exec-failed'
}

function runProbeProcess(
  executable: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal: AbortSignal,
  execFileImpl: CatalogExecFile,
): Promise<CatalogProcessCapture> {
  return new Promise((resolve) => {
    let settled = false
    let child: CatalogExecChild | null = null

    const settle = (capture: CatalogProcessCapture): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(capture)
    }
    const onAbort = (): void => {
      child?.kill('SIGTERM')
      settle({ exitCode: null, failureCode: 'probe-cancelled', safeOutput: '' })
    }

    child = execFileImpl(
      executable,
      [...argv],
      {
        cwd,
        env,
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const safeOutput = redactCatalogProbeOutput([stdout, stderr].filter(Boolean).join('\n'))
        const failureCode = processFailureCode(error, signal)
        const exitCode = typeof error?.code === 'number' ? error.code : error ? null : 0
        settle({ exitCode, failureCode, safeOutput })
      },
    )

    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function extractVersion(safeOutput: string): string | null {
  const firstLine = safeOutput.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
  const match = firstLine.match(/\bv?(\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?)\b/i)
  return match?.[1] ?? null
}

function resolutionObservation(resolution: CatalogExecutableResolution): CatalogProbeObservation | null {
  if (resolution.path) return null
  return {
    status: 'missing',
    version: null,
    diagnosticCode: resolution.errorCode ?? 'executable-not-found',
    safeOutput: '',
  }
}

export async function runAllowlistedCatalogProbe(
  policy: CatalogProbePolicy,
  mode: CatalogProbeMode,
  signal: AbortSignal,
  dependencies: CatalogProbeRuntimeDependencies = {},
): Promise<CatalogProbeObservation> {
  const environment = await (dependencies.environment ?? makeCodexEnv)()
  const projectRoots = (dependencies.projectRoots ?? (() => [process.cwd()]))()
  const resolver = dependencies.resolveExecutable ?? resolveCatalogExecutable
  const resolution = await resolver(policy.executableName, environment, projectRoots)
  const rejected = resolutionObservation(resolution)
  if (rejected) return rejected

  const executable = resolution.path
  if (!executable || !path.isAbsolute(executable)) {
    return {
      status: 'missing',
      version: null,
      diagnosticCode: 'untrusted-executable-path',
      safeOutput: '',
    }
  }

  const execFileImpl = dependencies.execFile ?? defaultExecFile
  const cwd = dependencies.neutralCwd ?? os.tmpdir()
  const minimalEnv = minimalProbeEnvironment(environment)
  const versionCapture = await runProbeProcess(
    executable,
    policy.versionArgv,
    minimalEnv,
    cwd,
    signal,
    execFileImpl,
  )
  if (versionCapture.failureCode) {
    return { failureCode: versionCapture.failureCode, safeOutput: versionCapture.safeOutput }
  }

  const version = extractVersion(versionCapture.safeOutput)
  const versionDiagnostic = versionCapture.exitCode === 0 ? null : 'version-probe-nonzero'
  if (mode !== 'manual' || !policy.manualArgv) {
    return {
      status: 'installed',
      version,
      diagnosticCode: versionDiagnostic,
      safeOutput: versionCapture.safeOutput,
    }
  }

  const manualCapture = await runProbeProcess(
    executable,
    policy.manualArgv,
    minimalEnv,
    cwd,
    signal,
    execFileImpl,
  )
  const safeOutput = redactCatalogProbeOutput(
    [versionCapture.safeOutput, manualCapture.safeOutput].filter(Boolean).join('\n'),
  )
  if (manualCapture.failureCode) return { failureCode: manualCapture.failureCode, safeOutput }
  if (policy.manualResult === 'authentication' && manualCapture.exitCode !== 0) {
    return {
      status: 'authentication-required',
      version,
      diagnosticCode: 'authentication-required',
      safeOutput,
    }
  }

  return {
    status: 'installed',
    version,
    diagnosticCode: versionDiagnostic,
    safeOutput,
  }
}

export class ToolCatalogService {
  private readonly freshnessMs: number
  private readonly now: () => number
  private readonly runtimeDependencies: CatalogProbeRuntimeDependencies
  private readonly customProbeRunner: CatalogProbeRunner | null
  private readonly probeRunner: CatalogProbeRunner
  private readonly results = new Map<ToolCatalogId, CachedProbeResult>()
  private readonly failures = new Map<ToolCatalogId, CachedProbeFailure>()
  private readonly testInFlight = new Map<ToolCatalogId, Promise<void>>()
  private readonly testControllers = new Map<ToolCatalogId, AbortController>()
  private refreshInFlight: Promise<void> | null = null
  private refreshController: AbortController | null = null
  private lastFullRefreshAt: number | null = null
  private lastObservedAt = 0
  private generation = 0

  constructor(options: ToolCatalogServiceOptions = {}) {
    this.freshnessMs = options.freshnessMs ?? DEFAULT_FRESHNESS_MS
    this.now = options.now ?? Date.now
    this.runtimeDependencies = {
      environment: options.environment,
      projectRoots: options.projectRoots,
      resolveExecutable: options.resolveExecutable,
      execFile: options.execFile,
      neutralCwd: options.neutralCwd,
    }
    this.customProbeRunner = options.probeRunner ?? null
    this.probeRunner = this.customProbeRunner ?? ((policy, mode, signal) => (
      runAllowlistedCatalogProbe(policy, mode, signal, this.runtimeDependencies)
    ))
  }

  async list(context: ToolCatalogRequestContext): Promise<ToolCatalogSnapshot> {
    if (!this.isFresh()) await this.runFullRefresh()
    return this.snapshot(context)
  }

  async refresh(context: ToolCatalogRequestContext): Promise<ToolCatalogSnapshot> {
    await this.runFullRefresh()
    return this.snapshot(context)
  }

  async test(catalogId: ToolCatalogId, context: ToolCatalogRequestContext): Promise<ToolCatalogSnapshot> {
    const parsedId = toolCatalogIdSchema.parse(catalogId)
    const policy = POLICY_BY_ID.get(parsedId)
    if (!policy) throw new Error(`Tool catalog ID is not allowlisted for testing: ${parsedId}`)

    let inFlight = this.testInFlight.get(parsedId)
    if (!inFlight) {
      const generation = this.nextGeneration()
      const controller = new AbortController()
      this.testControllers.set(parsedId, controller)
      inFlight = this.runOne(policy, 'manual', generation, controller.signal)
        .finally(() => {
          this.testInFlight.delete(parsedId)
          this.testControllers.delete(parsedId)
        })
      this.testInFlight.set(parsedId, inFlight)
    }
    await inFlight
    return this.snapshot(context)
  }

  dispose(): void {
    this.refreshController?.abort()
    for (const controller of this.testControllers.values()) controller.abort()
  }

  private isFresh(): boolean {
    return this.lastFullRefreshAt !== null && this.now() - this.lastFullRefreshAt < this.freshnessMs
  }

  private nextGeneration(): number {
    this.generation += 1
    return this.generation
  }

  private nextObservedAt(): string {
    this.lastObservedAt = Math.max(this.now(), this.lastObservedAt + 1)
    return new Date(this.lastObservedAt).toISOString()
  }

  private currentTime(): string {
    return new Date(Math.max(this.now(), this.lastObservedAt)).toISOString()
  }

  private async runFullRefresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight

    const generation = this.nextGeneration()
    const controller = new AbortController()
    const probeRunner = this.createFullRefreshProbeRunner()
    this.refreshController = controller
    const refresh = Promise.all(CATALOG_PROBE_POLICIES.map((policy) => (
      this.runOne(policy, 'automatic', generation, controller.signal, probeRunner)
    )))
      .then(() => undefined)
      .finally(() => {
        this.lastFullRefreshAt = this.now()
        if (this.refreshInFlight === refresh) this.refreshInFlight = null
        if (this.refreshController === controller) this.refreshController = null
      })
    this.refreshInFlight = refresh
    return refresh
  }

  private createFullRefreshProbeRunner(): CatalogProbeRunner {
    if (this.customProbeRunner) return this.customProbeRunner

    const dependencies = this.runtimeDependencies
    let environmentPromise: Promise<NodeJS.ProcessEnv> | null = null
    let projectRoots: string[] | null = null
    return (policy, mode, signal) => runAllowlistedCatalogProbe(policy, mode, signal, {
      ...dependencies,
      environment: () => {
        environmentPromise ??= (dependencies.environment ?? makeCodexEnv)()
        return environmentPromise
      },
      projectRoots: () => {
        projectRoots ??= (dependencies.projectRoots ?? (() => [process.cwd()]))()
        return projectRoots
      },
    })
  }

  private async runOne(
    policy: CatalogProbePolicy,
    mode: CatalogProbeMode,
    generation: number,
    signal: AbortSignal,
    probeRunner: CatalogProbeRunner = this.probeRunner,
  ): Promise<void> {
    let observation: CatalogProbeObservation
    try {
      observation = await probeRunner(policy, mode, signal)
    } catch {
      observation = { failureCode: signal.aborted ? 'probe-cancelled' : 'probe-exec-failed', safeOutput: '' }
    }
    const observedAt = this.nextObservedAt()

    if (observation.failureCode) {
      this.mergeFailure(policy.catalogId, generation, {
        code: observation.failureCode,
        observedAt,
      })
      return
    }

    const result = toolCatalogProbeResultSchema.parse({
      catalogId: policy.catalogId,
      status: observation.status ?? 'unknown',
      version: observation.version ?? null,
      observedAt,
      diagnosticCode: observation.diagnosticCode ?? null,
    })
    this.mergeResult(policy.catalogId, generation, result)
  }

  private mergeResult(catalogId: ToolCatalogId, generation: number, result: ToolCatalogProbeResult): void {
    const current = this.results.get(catalogId)
    if (current && (
      current.generation > generation
      || (current.generation === generation && current.result.observedAt > result.observedAt)
    )) return

    this.results.set(catalogId, { generation, result })
    const failure = this.failures.get(catalogId)
    if (!failure || failure.generation <= generation) this.failures.delete(catalogId)
  }

  private mergeFailure(
    catalogId: ToolCatalogId,
    generation: number,
    failure: ToolCatalogRefreshFailure,
  ): void {
    const currentResult = this.results.get(catalogId)
    if (currentResult && currentResult.generation > generation) return
    const currentFailure = this.failures.get(catalogId)
    if (currentFailure && currentFailure.generation > generation) return
    this.failures.set(catalogId, { generation, failure })
  }

  private snapshot(context: ToolCatalogRequestContext): ToolCatalogSnapshot {
    const now = this.currentTime()
    const allResults = [...this.results.values()].map((cached) => cached.result)
    const failedIds = new Set(this.failures.keys())
    const visibleResults = allResults.filter((result) => !failedIds.has(result.catalogId))
    const latestFailure = [...this.failures.values()]
      .sort((left, right) => right.generation - left.generation)[0]?.failure ?? null
    const common = {
      now,
      activeTask: context.taskKey,
      preferences: context.preferences,
      registryEvidence: context.registryEvidence,
    }
    const lastGood = allResults.length > 0
      ? assembleToolCatalog({ ...common, probeResults: allResults })
      : null

    return assembleToolCatalog({
      ...common,
      probeResults: visibleResults,
      lastGood,
      refreshFailure: latestFailure,
    })
  }
}

interface CatalogFrameLike {
  url: string
}

interface CatalogWebContentsLike {
  mainFrame: CatalogFrameLike
  isDestroyed: () => boolean
  getURL: () => string
}

interface CatalogWindowLike {
  isDestroyed: () => boolean
  webContents: CatalogWebContentsLike
}

interface CatalogInvokeEventLike {
  sender: unknown
  senderFrame: CatalogFrameLike | null
}

function isExpectedEntryUrl(actualValue: string, expectedValue: string): boolean {
  try {
    const actual = new URL(actualValue)
    const expected = new URL(expectedValue)
    return actual.protocol === expected.protocol
      && actual.host === expected.host
      && actual.pathname === expected.pathname
  } catch {
    return false
  }
}

export function isTrustedCatalogIpcSender(
  event: CatalogInvokeEventLike,
  mainWindow: CatalogWindowLike | null,
  expectedEntryUrl: string,
): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false
  if (event.sender !== mainWindow.webContents) return false
  if (!event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) return false
  return isExpectedEntryUrl(event.senderFrame.url, expectedEntryUrl)
    && isExpectedEntryUrl(mainWindow.webContents.getURL(), expectedEntryUrl)
}
