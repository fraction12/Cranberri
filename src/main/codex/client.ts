import { spawn, ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CodexEvent, CodexSessionSummary, CodexSessionThread, CodexSdkThreadItem, CodexSdkTurn, CodexTurnSettings, CodexRateLimitsReadResult, CodexAccountUsageReadResult, CodexUserInput, CodexWorker, CodexRuntimeContext, CodexServerRequestHandler, CodexTransportCapabilities } from '../../shared/codex'
import {
  codexWorkerIsActive,
  mergeAuthoritativeWorkerCollections,
  mergeCodexWorker,
  mergeWorkerCollections,
  normalizeCodexWorkerStatus,
  workerFromSessionSummary,
  workersFromSessionThread,
  workersFromThreadItem,
} from '../../shared/codex-workers'
import {
  buildCodexWorkerControlInput,
  type CodexWorkerControlAction,
} from '../../shared/codex-worker-control'
import { resolveCodexRuntime } from './env'
import { buildCodexTurnOverrides } from './turn-settings'
import {
  classifyThreadLifecycle,
  isAuthoritativeMissingThreadError,
  ThreadLifecycleDisagreementError,
  type CodexThreadLifecycleGateway,
  type ThreadLifecycleInspection,
} from './thread-lifecycle'
import { createMcpToolProgressEvent, createToolEventFromItem } from '../tools'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export const CODEX_INITIALIZE_PARAMS = {
  clientInfo: { name: 'cranberri', version: '0.1.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
} as const

interface Thread {
  id: string
  name?: string | null
}

interface MultiRootHistoryCursor {
  version: 1
  cursors: Record<string, string | null>
}

const MULTI_ROOT_HISTORY_CURSOR_PREFIX = 'cranberri-multi-root:'

function decodeMultiRootHistoryCursor(cursor: string | null | undefined): MultiRootHistoryCursor | null {
  if (!cursor?.startsWith(MULTI_ROOT_HISTORY_CURSOR_PREFIX)) return null
  try {
    const encoded = cursor.slice(MULTI_ROOT_HISTORY_CURSOR_PREFIX.length)
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MultiRootHistoryCursor
    return parsed.version === 1 && parsed.cursors && typeof parsed.cursors === 'object' ? parsed : null
  } catch {
    return null
  }
}

function encodeMultiRootHistoryCursor(cursors: Record<string, string | null>): string | null {
  if (!Object.values(cursors).some(Boolean)) return null
  const payload: MultiRootHistoryCursor = { version: 1, cursors }
  return `${MULTI_ROOT_HISTORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

function sessionRecency(session: CodexSessionSummary): number {
  return session.recencyAt ?? session.updatedAt ?? session.createdAt
}

interface SdkThread {
  id: string
  sessionId?: string
  forkedFromId?: string | null
  parentThreadId?: string | null
  ephemeral?: boolean
  name?: string | null
  preview?: string
  cwd?: string | { path?: string } | null
  createdAt?: number
  updatedAt?: number
  recencyAt?: number | null
  status?: unknown
  path?: string | null
  source?: unknown
  threadSource?: string | null
  agentNickname?: string | null
  agentRole?: string | null
  turns?: CodexSdkTurn[]
}

function cwdToString(cwd: SdkThread['cwd']): string | undefined {
  if (typeof cwd === 'string') return cwd
  if (cwd && typeof cwd === 'object' && typeof cwd.path === 'string') return cwd.path
  return undefined
}

export function normalizeThread(thread: SdkThread, archived: boolean): CodexSessionThread {
  const preview = thread.preview ?? ''
  const normalized: CodexSessionThread = {
    id: thread.id,
    sessionId: thread.sessionId,
    forkedFromId: thread.forkedFromId,
    parentThreadId: thread.parentThreadId,
    ephemeral: thread.ephemeral,
    source: thread.source,
    threadSource: thread.threadSource,
    agentNickname: thread.agentNickname,
    agentRole: thread.agentRole,
    title: thread.name || preview.split('\n')[0] || 'Untitled session',
    preview,
    cwd: cwdToString(thread.cwd),
    createdAt: thread.createdAt ?? 0,
    updatedAt: thread.updatedAt ?? thread.createdAt ?? 0,
    recencyAt: thread.recencyAt,
    archived,
    status: thread.status,
    path: thread.path,
    turnCount: thread.turns?.length ?? 0,
    turns: thread.turns ?? [],
  }
  normalized.workers = workersFromSessionThread(normalized)
  return normalized
}

export function normalizeThreadList(threads: SdkThread[], archived: boolean): CodexSessionSummary[] {
  const sessions = threads.map((thread) => normalizeThread(thread, archived))
  const childrenByParent = new Map<string, CodexSessionThread[]>()
  for (const session of sessions) {
    if (!session.parentThreadId) continue
    childrenByParent.set(session.parentThreadId, [...(childrenByParent.get(session.parentThreadId) ?? []), session])
  }
  const descendants = (parentThreadId: string, ancestors: Set<string>): CodexWorker[] => {
    if (ancestors.has(parentThreadId)) return []
    const nextAncestors = new Set(ancestors).add(parentThreadId)
    return (childrenByParent.get(parentThreadId) ?? []).flatMap((session) => {
      const worker = workerFromSessionSummary(session)
      if (!worker || nextAncestors.has(worker.threadId)) return []
      worker.workers = mergeAuthoritativeWorkerCollections(worker.workers, descendants(worker.threadId, nextAncestors))
      return [worker]
    })
  }
  return sessions
    .filter((session) => !session.parentThreadId)
    .map((session) => ({
      ...session,
      workers: mergeAuthoritativeWorkerCollections(session.workers, descendants(session.id, new Set())),
    }))
}

function getTurnApprovalSettings(mode: CodexTurnSettings['approvalMode']): { approvalPolicy?: string; sandboxPolicy?: { type: string } } {
  switch (mode) {
    case 'ask':
      return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } }
    case 'approve':
      return { approvalPolicy: 'on-failure', sandboxPolicy: { type: 'workspaceWrite' } }
    case 'full':
      return { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
    case 'custom':
    default:
      return {}
  }
}

function getThreadApprovalSettings(mode: CodexTurnSettings['approvalMode']): { approvalPolicy?: string; sandbox?: { type: string } } {
  switch (mode) {
    case 'ask':
      return { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }
    case 'approve':
      return { approvalPolicy: 'on-failure', sandbox: { type: 'workspaceWrite' } }
    case 'full':
      return { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
    case 'custom':
    default:
      return {}
  }
}

export class CodexClient extends EventEmitter implements CodexThreadLifecycleGateway {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number | string, { resolve: (res: JsonRpcResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  private buffer = ''
  private readonly processCwd: string
  private startPromise: Promise<void> | null = null
  private activeRunThreads = new Set<string>()
  private currentTurnIdByThread = new Map<string, string>()
  private agentMessagePhasesByThread = new Map<string, Map<string, string>>()
  private pendingApprovalsByThread = new Map<string, boolean>()
  private parentThreadByWorker = new Map<string, string>()
  private workerByThread = new Map<string, CodexWorker>()
  private runtimeByThread = new Map<string, CodexRuntimeContext>()
  private readonly requestHandlers = new Map<string, CodexServerRequestHandler>()
  private transportCapabilities: CodexTransportCapabilities = {
    cwdArrayHistory: false,
    explicitTurnCwd: false,
    dynamicTools: false,
  }

  constructor(cwd: string) {
    super()
    this.processCwd = cwd
  }

  /** @deprecated Runtime routing must be supplied to each thread or turn call. */
  setCwd(cwd: string): void {
    if (cwd !== this.processCwd) {
      this.emit('event', {
        type: 'log',
        level: 'warning',
        text: 'Ignoring mutable Codex cwd update; pass cwd to the thread or turn operation.',
      } satisfies CodexEvent)
    }
  }

  setTransportCapabilities(capabilities: CodexTransportCapabilities): void {
    this.transportCapabilities = { ...capabilities }
  }

  supportsTransportCapability(capability: keyof CodexTransportCapabilities): boolean {
    return this.transportCapabilities[capability]
  }

  requireTransportCapability(capability: keyof CodexTransportCapabilities): void {
    if (this.transportCapabilities[capability]) return
    const messages: Record<keyof CodexTransportCapabilities, string> = {
      cwdArrayHistory: 'Codex app-server does not support multi-root project history. Update Codex to load sessions across Local and worktrees.',
      explicitTurnCwd: 'Codex app-server does not support explicit turn cwd routing. Update Codex before running task-bound worktrees.',
      dynamicTools: 'Codex app-server does not support dynamic tool requests. Update Codex before using environment tools.',
    }
    throw new Error(messages[capability])
  }

  isThreadRunning(threadId: string): boolean {
    return this.activeRunThreads.has(threadId)
  }

  hasActiveWorkers(threadId: string): boolean {
    return [...this.workerByThread.values()].some(
      (worker) => worker.parentThreadId === threadId && codexWorkerIsActive(worker.status),
    )
  }

  registerRequestHandler(method: string, handler: CodexServerRequestHandler): () => void {
    if (!method || this.requestHandlers.has(method)) {
      throw new Error(`Codex request handler already registered or invalid: ${method || '<empty>'}`)
    }
    if (this.requestHandlers.size >= 16) throw new Error('Codex request handler limit reached')
    this.requestHandlers.set(method, handler)
    return () => {
      if (this.requestHandlers.get(method) === handler) this.requestHandlers.delete(method)
    }
  }

  private rememberWorker(worker: CodexWorker, emit = false): CodexWorker {
    const merged = mergeCodexWorker(this.workerByThread.get(worker.threadId), worker)
    this.workerByThread.set(worker.threadId, merged)
    this.parentThreadByWorker.set(worker.threadId, merged.parentThreadId)
    if (emit) {
      this.emit('event', {
        type: 'worker_updated',
        threadId: merged.parentThreadId,
        worker: merged,
      } satisfies CodexEvent)
    }
    return merged
  }

  private rememberSessionWorkers(session: CodexSessionSummary, emit = false): void {
    const sessionWorker = workerFromSessionSummary(session)
    if (sessionWorker) this.rememberWorkerTree(sessionWorker, emit)
    for (const worker of session.workers ?? []) this.rememberWorkerTree(worker, emit)
  }

  private rememberWorkerTree(worker: CodexWorker, emit: boolean): void {
    const remembered = this.rememberWorker(worker, emit)
    for (const child of remembered.workers ?? []) this.rememberWorkerTree(child, emit)
  }

  private updateKnownWorker(
    workerThreadId: string,
    update: Partial<Omit<CodexWorker, 'threadId' | 'parentThreadId'>>,
  ): void {
    const parentThreadId = this.parentThreadByWorker.get(workerThreadId)
    if (!parentThreadId) return
    const current = this.workerByThread.get(workerThreadId)
    this.rememberWorker({
      threadId: workerThreadId,
      parentThreadId,
      status: update.status ?? current?.status ?? 'pendingInit',
      updatedAt: update.updatedAt ?? Date.now(),
      ...update,
    }, true)
  }

  async start(): Promise<void> {
    if (this.process && !this.startPromise) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startProcess()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async startProcess(): Promise<void> {
    const runtime = await resolveCodexRuntime()
    let startupStderr = ''
    this.process = spawn(runtime.executable, ['app-server', '--stdio'], {
      cwd: this.processCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...runtime.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    return new Promise<void>((resolve, reject) => {
      this.process?.on('spawn', () => {
        resolve()
      })

      this.process?.on('error', (err) => {
        for (const request of this.pending.values()) {
          clearTimeout(request.timer)
          request.reject(err)
        }
        this.pending.clear()
        this.process = null
        this.startPromise = null
        reject(err)
      })

      this.process?.stdout?.on('data', (data: Buffer) => this.onData(data))
      this.process?.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8').trim()
        startupStderr = `${startupStderr}\n${text}`.trim().slice(-4096)
        if (text) this.emit('event', { type: 'log', level: 'stderr', text } as CodexEvent)
      })

      this.process?.on('exit', (code) => {
        const identity = `${runtime.executable}${runtime.version ? ` (${runtime.version})` : ''}`
        const detail = startupStderr ? `: ${startupStderr}` : ''
        const message = `Codex app-server ${identity} exited with code ${code ?? 'unknown'}${detail}`
        this.emitRunEnd('', message)
        const error = new Error(message)
        for (const request of this.pending.values()) {
          clearTimeout(request.timer)
          request.reject(error)
        }
        this.pending.clear()
        this.process = null
        this.startPromise = null
      })
    }).then(() => this.initializeSession())
  }

  private async initializeSession(): Promise<void> {
    const response = await this.call('initialize', CODEX_INITIALIZE_PARAMS)
    const capabilities = (response.result as { capabilities?: Record<string, unknown> } | undefined)?.capabilities
    if (capabilities) {
      this.transportCapabilities = {
        cwdArrayHistory: capabilities.cwdArrayHistory === true || capabilities.threadListCwds === true,
        explicitTurnCwd: capabilities.explicitTurnCwd === true || capabilities.turnStartCwd === true,
        dynamicTools: capabilities.dynamicTools === true || capabilities.serverRequests === true,
      }
    }
    this.notify('initialized')
  }

  stop(): void {
    this.process?.kill('SIGTERM')
    this.process = null
    this.startPromise = null
    this.activeRunThreads.clear()
    this.currentTurnIdByThread.clear()
    this.agentMessagePhasesByThread.clear()
    this.parentThreadByWorker.clear()
    this.workerByThread.clear()
    this.runtimeByThread.clear()
    this.requestHandlers.clear()
  }

  async createThread(cwdOrRuntime: string | CodexRuntimeContext = this.processCwd, settings?: CodexTurnSettings): Promise<Thread> {
    const runtime = typeof cwdOrRuntime === 'string' ? { cwd: cwdOrRuntime } : cwdOrRuntime
    const approvalSettings = getThreadApprovalSettings(settings?.approvalMode)
    if (runtime.dynamicTools) this.requireTransportCapability('dynamicTools')
    const res = await this.call('thread/start', {
      cwd: runtime.cwd,
      ...(runtime.dynamicTools ? { dynamicTools: runtime.dynamicTools } : {}),
      ...approvalSettings,
    })
    const thread = (res.result as { thread: Thread } | undefined)?.thread
    if (!thread?.id) {
      throw new Error('thread/start did not return a thread id')
    }
    if (thread.name) {
      this.emit('event', { type: 'thread_name_updated', threadId: thread.id, title: thread.name } as CodexEvent)
    }
    this.runtimeByThread.set(thread.id, { ...runtime })
    return thread
  }

  async sendMessage(threadId: string, input: CodexUserInput[], settings?: CodexTurnSettings, runtime?: CodexRuntimeContext): Promise<void> {
    const resolvedRuntime = runtime ?? this.runtimeByThread.get(threadId)
    if (runtime) {
      this.requireTransportCapability('explicitTurnCwd')
      this.runtimeByThread.set(threadId, { ...runtime })
    }
    const approvalSettings = getTurnApprovalSettings(settings?.approvalMode)
    const res = await this.call('turn/start', {
      threadId,
      input,
      ...(resolvedRuntime ? { cwd: resolvedRuntime.cwd } : {}),
      ...buildCodexTurnOverrides(settings),
      ...approvalSettings,
    })
    const turnId = (res.result as { turn?: { id?: string } } | undefined)?.turn?.id
    if (turnId) this.currentTurnIdByThread.set(threadId, turnId)
  }

  async steerThread(threadId: string, input: CodexUserInput[]): Promise<void> {
    const turnId = await this.resolveActiveTurnId(threadId)
    if (!turnId) throw new Error('This worker does not have an active turn to steer.')
    await this.call('turn/steer', {
      threadId,
      input,
      expectedTurnId: turnId,
    })
  }

  async controlWorker(
    parentThreadId: string,
    workerThreadId: string,
    action: CodexWorkerControlAction,
    workerInput: CodexUserInput[],
  ): Promise<void> {
    if (action === 'stop') {
      await this.interrupt(workerThreadId)
      return
    }
    const content = workerInput
      .filter((part): part is Extract<CodexUserInput, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!content) throw new Error('Worker instructions cannot be empty.')
    const input = buildCodexWorkerControlInput(workerThreadId, action, content, workerInput)
    const activeParentTurnId = await this.resolveActiveTurnId(parentThreadId)
    if (activeParentTurnId) {
      try {
        await this.call('turn/steer', {
          threadId: parentThreadId,
          input,
          expectedTurnId: activeParentTurnId,
        })
        return
      } catch (error) {
        this.currentTurnIdByThread.delete(parentThreadId)
        const latestParentTurnId = await this.resolveActiveTurnId(parentThreadId)
        if (latestParentTurnId === activeParentTurnId) throw error
        if (latestParentTurnId) {
          await this.call('turn/steer', {
            threadId: parentThreadId,
            input,
            expectedTurnId: latestParentTurnId,
          })
          return
        }
      }
    }
    const runtime = this.runtimeByThread.get(parentThreadId)
    await this.resumeThread(parentThreadId, runtime)
    await this.sendMessage(parentThreadId, input, undefined, runtime)
  }

  async compactThread(threadId: string): Promise<void> {
    await this.call('thread/compact/start', { threadId })
  }

  async runOneShot(cwd: string, content: string, settings?: CodexTurnSettings, timeoutMs = 120_000): Promise<string> {
    const thread = await this.createThread(cwd)
    return new Promise((resolve, reject) => {
      let finalText = ''
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Codex commit message generation timed out'))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timeout)
        this.off('event', onEvent)
      }

      const onEvent = (event: CodexEvent) => {
        if ('threadId' in event && event.threadId !== thread.id) return
        if (event.type === 'final_answer') {
          finalText = event.text
          cleanup()
          resolve(finalText)
          return
        }
        if (event.type === 'agent_message_completed' && event.text) {
          finalText = event.text
        }
        if (event.type === 'run_end' && event.error) {
          cleanup()
          reject(new Error(event.error))
        }
      }

      this.on('event', onEvent)
      this.sendMessage(thread.id, [{ type: 'text', text: content }], settings).catch((err: unknown) => {
        cleanup()
        reject(err)
      })
    })
  }

  async listThreads(cwd: string | string[], options: { archived?: boolean; cursor?: string | null; limit?: number; searchTerm?: string | null } = {}): Promise<{ sessions: CodexSessionSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }> {
    if (Array.isArray(cwd) && cwd.length > 1 && !this.supportsTransportCapability('cwdArrayHistory')) {
      const roots = [...new Set(cwd)]
      const compositeCursor = decodeMultiRootHistoryCursor(options.cursor)
      const pages = await Promise.all(roots.map(async (root) => {
        const hasCursor = compositeCursor && Object.prototype.hasOwnProperty.call(compositeCursor.cursors, root)
        const rootCursor = hasCursor ? compositeCursor.cursors[root] : compositeCursor ? null : options.cursor
        if (hasCursor && rootCursor === null) {
          return { root, sessions: [] as CodexSessionSummary[], nextCursor: null, backwardsCursor: null }
        }
        const page = await this.listThreads(root, { ...options, cursor: rootCursor })
        return { root, ...page }
      }))
      const sessions = new Map<string, CodexSessionSummary>()
      for (const page of pages) {
        for (const session of page.sessions) {
          const current = sessions.get(session.id)
          if (!current || sessionRecency(session) >= sessionRecency(current)) sessions.set(session.id, session)
        }
      }
      const cursorRecord = (key: 'nextCursor' | 'backwardsCursor') => Object.fromEntries(
        pages.map((page) => [page.root, page[key] ?? null]),
      )
      return {
        sessions: [...sessions.values()].sort((left, right) => sessionRecency(right) - sessionRecency(left)),
        nextCursor: encodeMultiRootHistoryCursor(cursorRecord('nextCursor')),
        backwardsCursor: encodeMultiRootHistoryCursor(cursorRecord('backwardsCursor')),
      }
    }
    const archived = options.archived ?? false
    const res = await this.call('thread/list', {
      cwd,
      archived,
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      searchTerm: options.searchTerm ?? null,
      sortKey: 'recency_at',
      sortDirection: 'desc',
    })
    const result = res.result as { data?: SdkThread[]; nextCursor?: string | null; backwardsCursor?: string | null } | undefined
    const roots = result?.data ?? []
    for (const thread of roots) {
      const threadCwd = cwdToString(thread.cwd)
      if (threadCwd) this.runtimeByThread.set(thread.id, { cwd: threadCwd })
    }
    const descendants = await Promise.all(roots.map((thread) => this.listDescendantThreads(thread.id).catch(() => [])))
    const descendantsWithOutcomes = await Promise.all(
      descendants.flat().map((descendant) => this.withLatestTurnOutcome(descendant)),
    )
    const sessions = normalizeThreadList([...roots, ...descendantsWithOutcomes], archived)
    for (const session of sessions) this.rememberSessionWorkers(session)
    return {
      sessions,
      nextCursor: result?.nextCursor,
      backwardsCursor: result?.backwardsCursor,
    }
  }

  async readThread(threadId: string, archived = false): Promise<CodexSessionThread> {
    const res = await this.call('thread/read', { threadId, includeTurns: true })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/read did not return a thread')
    const descendants = await this.listDescendantThreads(thread.id).catch(() => [])
    const descendantsWithOutcomes = await Promise.all(descendants.map((descendant) => this.withLatestTurnOutcome(descendant)))
    const normalized = normalizeThread(thread, archived)
    const treeRoot = normalizeThreadList([
      { ...thread, parentThreadId: null },
      ...descendantsWithOutcomes,
    ], archived)[0]
    normalized.workers = mergeWorkerCollections(normalized.workers, treeRoot?.workers)
    this.rememberSessionWorkers(normalized)
    return normalized
  }

  async inspectThreadLifecycle(threadId: string): Promise<ThreadLifecycleInspection> {
    let thread: SdkThread | undefined
    try {
      const res = await this.call('thread/read', { threadId, includeTurns: false })
      if (res.error) throw new Error(res.error.message)
      thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    } catch (error) {
      if (isAuthoritativeMissingThreadError(error)) {
        return { threadId, state: 'missing', cwd: null }
      }
      throw error
    }

    if (!thread?.id) throw new Error('thread/read did not return a thread')
    if (thread.id !== threadId) {
      throw new ThreadLifecycleDisagreementError(threadId, cwdToString(thread.cwd) ?? null, false, false)
    }
    const cwd = cwdToString(thread.cwd)
    if (!cwd) throw new ThreadLifecycleDisagreementError(threadId, null, false, false)

    const listedActive = await this.isThreadListedForCwd(threadId, cwd, false)
    const listedArchived = await this.isThreadListedForCwd(threadId, cwd, true)
    return classifyThreadLifecycle(threadId, cwd, listedActive, listedArchived)
  }

  async resumeThread(threadId: string, cwdOrRuntime?: string | CodexRuntimeContext, settings?: CodexTurnSettings): Promise<CodexSessionThread> {
    const runtime = typeof cwdOrRuntime === 'string'
      ? { cwd: cwdOrRuntime }
      : cwdOrRuntime ?? this.runtimeByThread.get(threadId) ?? { cwd: this.processCwd }
    const approvalSettings = getThreadApprovalSettings(settings?.approvalMode)
    const res = await this.call('thread/resume', {
      threadId,
      cwd: runtime.cwd,
      model: settings?.model ?? null,
      ...approvalSettings,
    })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/resume did not return a thread')
    const normalized = normalizeThread(thread, false)
    this.runtimeByThread.set(threadId, { ...runtime })
    this.rememberSessionWorkers(normalized)
    return normalized
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.call('thread/archive', { threadId })
  }

  async unarchiveThread(threadId: string): Promise<CodexSessionThread> {
    const res = await this.call('thread/unarchive', { threadId })
    const thread = (res.result as { thread?: SdkThread } | undefined)?.thread
    if (!thread?.id) throw new Error('thread/unarchive did not return a thread')
    const normalized = normalizeThread(thread, false)
    this.rememberSessionWorkers(normalized)
    return normalized
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.call('thread/delete', { threadId })
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.call('thread/name/set', { threadId, name })
  }

  private async isThreadListedForCwd(threadId: string, cwd: string, archived: boolean): Promise<boolean> {
    let cursor: string | null = null
    let found = false
    const visitedCursors = new Set<string | null>()
    do {
      if (visitedCursors.has(cursor)) {
        throw new Error(`Codex thread/list repeated cursor while inspecting ${threadId}`)
      }
      visitedCursors.add(cursor)
      const res = await this.call('thread/list', {
        cwd,
        archived,
        cursor,
        limit: 100,
        sortKey: 'created_at',
        sortDirection: 'asc',
      })
      if (res.error) throw new Error(res.error.message)
      const result = res.result as { data?: SdkThread[]; nextCursor?: string | null } | undefined
      if (!result || !Array.isArray(result.data)) throw new Error('thread/list did not return thread data')
      found ||= result.data.some((candidate) => candidate.id === threadId)
      cursor = result.nextCursor ?? null
    } while (cursor)
    return found
  }

  private async listDescendantThreads(ancestorThreadId: string): Promise<SdkThread[]> {
    const descendants: SdkThread[] = []
    for (const archived of [false, true]) {
      let cursor: string | null = null
      try {
        do {
          const res = await this.call('thread/list', {
            ancestorThreadId,
            archived,
            cursor,
            limit: 100,
            sortKey: 'created_at',
            sortDirection: 'asc',
          })
          const result = res.result as { data?: SdkThread[]; nextCursor?: string | null } | undefined
          descendants.push(...(result?.data ?? []))
          cursor = result?.nextCursor ?? null
        } while (cursor)
      } catch {
        // Older app-server builds may reject descendant or archived-tree filters.
      }
    }
    return [...new Map(descendants.map((thread) => [thread.id, thread])).values()]
  }

  private async withLatestTurnOutcome(thread: SdkThread): Promise<SdkThread> {
    const statusType = thread.status && typeof thread.status === 'object'
      ? (thread.status as { type?: unknown }).type
      : thread.status
    if (statusType === 'active') return thread
    try {
      const res = await this.call('thread/turns/list', {
        threadId: thread.id,
        cursor: null,
        limit: 1,
        sortDirection: 'desc',
        itemsView: 'summary',
      })
      const latest = (res.result as { data?: Array<{ status?: string }> } | undefined)?.data?.[0]
      const workerStatus = latest?.status === 'inProgress'
        ? 'running'
        : latest?.status === 'failed'
          ? 'errored'
          : latest?.status
      return workerStatus ? { ...thread, status: workerStatus } : thread
    } catch {
      return thread
    }
  }

  async getRateLimits(): Promise<CodexRateLimitsReadResult> {
    const res = await this.call('account/rateLimits/read', {})
    return res.result as CodexRateLimitsReadResult
  }

  async getAccountUsage(): Promise<CodexAccountUsageReadResult> {
    const res = await this.call('account/usage/read', {})
    return res.result as CodexAccountUsageReadResult
  }

  async consumeRateLimitResetCredit(idempotencyKey: string): Promise<{ outcome: string }> {
    const res = await this.call('account/rateLimitResetCredit/consume', { idempotencyKey })
    return res.result as { outcome: string }
  }

  async listApps(options: { threadId?: string | null; forceRefetch?: boolean } = {}): Promise<unknown> {
    const res = await this.call('app/list', {
      limit: 100,
      threadId: options.threadId ?? null,
      forceRefetch: options.forceRefetch ?? false,
    })
    if (res.error) throw new Error(res.error.message)
    return res.result
  }

  async listMcpServerStatus(options: { threadId?: string | null } = {}): Promise<unknown> {
    const res = await this.call('mcpServerStatus/list', {
      limit: 100,
      detail: 'toolsAndAuthOnly',
      threadId: options.threadId ?? null,
    })
    if (res.error) throw new Error(res.error.message)
    return res.result
  }

  async approve(event: unknown, threadId: string): Promise<void> {
    await this.call('thread/approveGuardianDeniedAction', { threadId, event })
  }

  async interrupt(threadId: string): Promise<void> {
    const turnId = await this.resolveActiveTurnId(threadId)
    if (!turnId) throw new Error('This task does not have an active turn to stop.')
    await this.call('turn/interrupt', { threadId, turnId })
  }

  /** @deprecated use interrupt() */
  async abort(threadId: string): Promise<void> {
    await this.interrupt(threadId)
  }

  private async resolveActiveTurnId(threadId: string): Promise<string | null> {
    const knownTurnId = this.currentTurnIdByThread.get(threadId)
    if (knownTurnId) return knownTurnId
    const res = await this.call('thread/read', { threadId, includeTurns: true })
    const turns = (res.result as { thread?: SdkThread } | undefined)?.thread?.turns ?? []
    const activeTurn = [...turns].reverse().find((turn) => turn.status === 'inProgress')
    if (activeTurn?.id) this.currentTurnIdByThread.set(threadId, activeTurn.id)
    return activeTurn?.id ?? null
  }

  private onData(data: Buffer): void {
    this.buffer += data.toString('utf8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification | JsonRpcRequest
        this.handleMessage(msg)
      } catch {
        this.emit('event', { type: 'log', level: 'parse-error', text: trimmed } as CodexEvent)
      }
    }
  }

  private emitRunStart(threadId: string, turnId?: string, startedAt?: number): void {
    if (threadId) this.activeRunThreads.add(threadId)
    this.emit('event', { type: 'run_start', threadId, turnId, startedAt } as CodexEvent)
  }

  private emitRunEnd(
    threadId: string,
    error?: string,
    turn?: { turnId?: string; status?: 'running' | 'completed' | 'failed' | 'interrupted'; completedAt?: number; durationMs?: number },
  ): void {
    if (threadId) {
      if (!this.activeRunThreads.has(threadId) && !error && !turn?.turnId) return
      this.activeRunThreads.delete(threadId)
    }
    this.emit('event', { type: 'run_end', threadId, error, ...turn } as CodexEvent)
  }

  private rememberWorkersFromItem(parentThreadId: string, item: unknown): void {
    for (const worker of workersFromThreadItem(
      parentThreadId,
      item && typeof item === 'object' ? item : undefined,
      Date.now(),
    )) {
      this.rememberWorker(worker, true)
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification | JsonRpcRequest): void {
    if ('id' in msg && msg.id !== undefined && 'method' in msg) {
      void this.handleServerRequest(msg)
      return
    }

    if ('id' in msg && msg.id !== undefined) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        const response = msg as JsonRpcResponse
        if (response.error) pending.reject(new Error(response.error.message))
        else pending.resolve(response)
        this.pending.delete(msg.id)
      }
      return
    }

    if (!('method' in msg)) return
    const n = msg as JsonRpcNotification
    const params = n.params ?? {}
    const notificationThread = (params as { thread?: SdkThread }).thread
    const threadId = (params.threadId as string | undefined) ?? notificationThread?.id ?? ''
    const method = n.method

    switch (method) {
      case 'thread/started': {
        if (!notificationThread?.id) break
        const session = normalizeThread(notificationThread, false)
        this.rememberSessionWorkers(session, true)
        if (session.title) {
          this.emit('event', { type: 'thread_name_updated', threadId: session.id, title: session.title } as CodexEvent)
        }
        break
      }
      case 'thread/name/updated': {
        const title = (params as { threadName?: string }).threadName ?? (params as { name?: string }).name ?? 'New thread'
        this.emit('event', { type: 'thread_name_updated', threadId, title } as CodexEvent)
        this.updateKnownWorker(threadId, { title, updatedAt: Date.now() })
        break
      }
      case 'thread/status/changed': {
        const status = params.status as { type?: string; activeFlags?: string[] } | undefined
        if (status?.type === 'active') {
          this.emitRunStart(threadId)
          if (status?.activeFlags?.includes('waitingOnApproval')) {
            // Only emit a placeholder if we don't already have a real guardian approval pending.
            // This avoids creating an actionable approval card with an empty event.
            const hasRealApproval = this.pendingApprovalsByThread.get(threadId) ?? false
            if (!hasRealApproval) {
              this.emit('event', { type: 'approval_request', threadId, approval: { id: crypto.randomUUID(), reviewId: '', action: {}, review: {}, description: 'Waiting on approval' } } as CodexEvent)
            }
          }
        } else if (status?.type === 'idle') {
          this.emitRunEnd(threadId)
        }
        const workerStatus = normalizeCodexWorkerStatus(status, 'running')
        const currentWorker = this.workerByThread.get(threadId)
        if (workerStatus !== 'idle' || !currentWorker || codexWorkerIsActive(currentWorker.status)) {
          this.updateKnownWorker(threadId, { status: workerStatus, updatedAt: Date.now() })
        }
        break
      }
      case 'turn/started': {
        const turn = (params as { turn?: { id?: string; startedAt?: number | null } }).turn
        const turnId = turn?.id
        if (turnId) this.currentTurnIdByThread.set(threadId, turnId)
        this.emitRunStart(threadId, turnId, typeof turn?.startedAt === 'number' ? turn.startedAt * 1000 : Date.now())
        this.updateKnownWorker(threadId, { status: 'running', updatedAt: Date.now() })
        break
      }
      case 'agent_message': {
        const message = (params as { message?: string }).message ?? ''
        const phase = (params as { phase?: string }).phase
        if (message) {
          this.emit('event', { type: 'agent_message_completed', threadId, itemId: crypto.randomUUID(), text: message, phase } as CodexEvent)
        }
        break
      }
      case 'task_complete': {
        const text = (params as { last_agent_message?: string }).last_agent_message ?? ''
        if (text) this.emit('event', { type: 'final_answer', threadId, text } as CodexEvent)
        this.emitRunEnd(threadId)
        break
      }
      case 'turn/completed': {
        const turn = (params as { turn?: { id?: string; status?: string; error?: { message?: string }; completedAt?: number | null; durationMs?: number | null } }).turn
        const error = turn?.error?.message
        const workerStatus = turn?.status === 'interrupted'
          ? 'interrupted'
          : turn?.status === 'failed' || error
            ? 'errored'
            : 'completed'
        this.currentTurnIdByThread.delete(threadId)
        this.agentMessagePhasesByThread.delete(threadId)
        this.emitRunEnd(threadId, error, {
          turnId: turn?.id,
          status: turn?.status === 'interrupted'
            ? 'interrupted'
            : turn?.status === 'failed' || error
              ? 'failed'
              : 'completed',
          completedAt: typeof turn?.completedAt === 'number' ? turn.completedAt * 1000 : Date.now(),
          durationMs: typeof turn?.durationMs === 'number' ? turn.durationMs : undefined,
        })
        this.updateKnownWorker(threadId, {
          status: workerStatus,
          message: error ?? (workerStatus === 'errored' ? 'Worker turn failed' : ''),
          updatedAt: Date.now(),
        })
        break
      }
      case 'token_count':
      case 'codex/token_count': {
        const info = (params as { info?: { last_token_usage?: { total_tokens?: number }; model_context_window?: number } }).info
        const usedTokens = info?.last_token_usage?.total_tokens
        const contextWindow = info?.model_context_window
        if (usedTokens !== undefined && contextWindow) {
          this.emit('event', { type: 'context_usage', threadId, usedTokens, contextWindow } as CodexEvent)
        }
        break
      }
      case 'thread/tokenUsage/updated': {
        const tokenUsage = (params as { tokenUsage?: { last?: { totalTokens?: number }; modelContextWindow?: number } }).tokenUsage
        const usedTokens = tokenUsage?.last?.totalTokens
        const contextWindow = tokenUsage?.modelContextWindow
        if (usedTokens !== undefined && contextWindow) {
          this.emit('event', { type: 'context_usage', threadId, usedTokens, contextWindow } as CodexEvent)
        }
        break
      }
      case 'item/started': {
        const payload = params as { turnId?: string; startedAtMs?: number; item?: CodexSdkThreadItem }
        const item = payload.item
        const itemType = item?.type ?? 'unknown'
        if (itemType === 'agentMessage' && item?.id && item.phase) {
          const phases = this.agentMessagePhasesByThread.get(threadId) ?? new Map<string, string>()
          phases.set(item.id, item.phase)
          this.agentMessagePhasesByThread.set(threadId, phases)
        }
        this.emit('event', {
          type: 'item_started',
          threadId,
          turnId: payload.turnId,
          itemId: item?.id,
          itemType,
          item,
          startedAt: payload.startedAtMs ?? Date.now(),
        } as CodexEvent)
        this.rememberWorkersFromItem(threadId, item)
        const toolEvent = createToolEventFromItem(threadId, item, 'started')
        if (toolEvent) this.emit('event', { type: 'tool_event', threadId, event: toolEvent } as CodexEvent)
        if (itemType === 'contextCompaction') {
          this.emit('event', { type: 'context_compaction', threadId, turnId: payload.turnId, state: 'started' } as CodexEvent)
        }
        break
      }
      case 'context_compacted':
      case 'thread/compacted': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } as CodexEvent)
        break
      }
      case 'warning': {
        const text = (params as { message?: string }).message ?? ''
        if (text) this.emit('event', { type: 'log', level: 'warning', text } as CodexEvent)
        break
      }
      case 'context/summary/started':
      case 'context/compaction/started': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'started' } as CodexEvent)
        break
      }
      case 'context/summary/completed':
      case 'context/compaction/completed': {
        this.emit('event', { type: 'context_compaction', threadId, state: 'completed' } as CodexEvent)
        break
      }
      case 'context/summary/failed':
      case 'context/compaction/failed': {
        const message = (params as { message?: string }).message ?? ''
        this.emit('event', { type: 'context_compaction', threadId, state: 'failed', message } as CodexEvent)
        break
      }
      case 'item/agentMessage/delta': {
        const payload = params as { turnId?: string; itemId?: string; delta?: string; item?: { phase?: string } }
        const itemId = payload.itemId
        const delta = payload.delta ?? ''
        const phase = itemId
          ? payload.item?.phase ?? this.agentMessagePhasesByThread.get(threadId)?.get(itemId)
          : undefined
        if (itemId && delta) this.emit('event', { type: 'agent_message_delta', threadId, turnId: payload.turnId, itemId, delta, phase } as CodexEvent)
        break
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const payload = params as { turnId?: string; itemId?: string; delta?: string }
        const itemId = payload.itemId
        const delta = payload.delta ?? ''
        if (itemId && delta) this.emit('event', { type: 'agent_message_delta', threadId, turnId: payload.turnId, itemId, delta, phase: 'commentary' } as CodexEvent)
        break
      }
      case 'item/commandExecution/outputDelta': {
        const payload = params as { turnId?: string; itemId?: string; delta?: string; output?: string }
        const delta = payload.delta ?? payload.output ?? ''
        if (payload.turnId && payload.itemId && delta) {
          this.emit('event', {
            type: 'item_progress',
            threadId,
            turnId: payload.turnId,
            itemId: payload.itemId,
            progress: { type: 'command_output', delta },
          } as CodexEvent)
        }
        break
      }
      case 'item/fileChange/outputDelta': {
        const payload = params as { turnId?: string; itemId?: string; delta?: string }
        if (payload.turnId && payload.itemId && payload.delta) {
          this.emit('event', {
            type: 'item_progress',
            threadId,
            turnId: payload.turnId,
            itemId: payload.itemId,
            progress: { type: 'file_output', delta: payload.delta },
          } as CodexEvent)
        }
        break
      }
      case 'item/fileChange/patchUpdated': {
        const payload = params as { turnId?: string; itemId?: string; changes?: CodexSdkThreadItem['changes'] }
        if (payload.turnId && payload.itemId && Array.isArray(payload.changes)) {
          this.emit('event', {
            type: 'item_progress',
            threadId,
            turnId: payload.turnId,
            itemId: payload.itemId,
            progress: { type: 'file_patch', changes: payload.changes },
          } as CodexEvent)
        }
        break
      }
      case 'turn/diff/updated': {
        const payload = params as { turnId?: string; diff?: string }
        if (payload.turnId && typeof payload.diff === 'string') {
          this.emit('event', { type: 'turn_diff_updated', threadId, turnId: payload.turnId, diff: payload.diff } as CodexEvent)
        }
        break
      }
      case 'item/completed': {
        const payload = params as { turnId?: string; completedAtMs?: number; item?: CodexSdkThreadItem }
        const item = payload.item
        this.emit('event', {
          type: 'item_completed',
          threadId,
          turnId: payload.turnId,
          itemId: item?.id,
          itemType: item?.type ?? 'unknown',
          item,
          completedAt: payload.completedAtMs ?? Date.now(),
        } as CodexEvent)
        this.rememberWorkersFromItem(threadId, item)
        const toolEvent = createToolEventFromItem(threadId, item, 'completed')
        if (toolEvent) this.emit('event', { type: 'tool_event', threadId, event: toolEvent } as CodexEvent)
        if (item?.type === 'contextCompaction') {
          this.emit('event', { type: 'context_compaction', threadId, turnId: payload.turnId, state: 'completed' } as CodexEvent)
        }
        if (item?.type === 'agentMessage' && item.id) {
          const phases = this.agentMessagePhasesByThread.get(threadId)
          const phase = item.phase ?? phases?.get(item.id)
          this.emit('event', { type: 'agent_message_completed', threadId, turnId: payload.turnId, itemId: item.id, text: item.text ?? '', phase: phase ?? undefined } as CodexEvent)
          phases?.delete(item.id)
          if (phases?.size === 0) this.agentMessagePhasesByThread.delete(threadId)
        }
        break
      }
      case 'thread/deleted': {
        this.updateKnownWorker(threadId, { status: 'notFound', updatedAt: Date.now() })
        break
      }
      case 'item/mcpToolCall/progress': {
        const payload = params as { turnId?: string; itemId?: string; message?: string }
        if (payload.turnId && payload.itemId && payload.message) {
          this.emit('event', {
            type: 'item_progress',
            threadId,
            turnId: payload.turnId,
            itemId: payload.itemId,
            progress: { type: 'mcp_progress', message: payload.message },
          } as CodexEvent)
        }
        const toolEvent = createMcpToolProgressEvent(threadId, payload.itemId, payload.message ?? '')
        if (toolEvent) this.emit('event', { type: 'tool_event', threadId, event: toolEvent } as CodexEvent)
        break
      }
      case 'item/autoApprovalReview/started':
      case 'item/guardianApprovalReview/started': {
        const payload = params as {
          reviewId?: string
          targetItemId?: string | null
          action?: unknown
          review?: unknown
        }
        const action = payload.action ?? {}
        const review = payload.review ?? {}
        const description = this.describeGuardianAction(action)
        const reviewId = payload.reviewId ?? crypto.randomUUID()
        this.pendingApprovalsByThread.set(threadId, true)
        this.emit('event', {
          type: 'approval_request',
          threadId,
          approval: {
            id: reviewId,
            reviewId,
            targetItemId: payload.targetItemId,
            action,
            review,
            description,
          },
        } as CodexEvent)
        break
      }
      case 'item/autoApprovalReview/completed':
      case 'item/guardianApprovalReview/completed': {
        const payload = params as {
          reviewId?: string
          action?: { type?: string }
          review?: { status?: string }
        }
        this.pendingApprovalsByThread.delete(threadId)
        const status = payload.review?.status ?? 'approved'
        this.emit('event', { type: 'approval_completed', threadId, reviewId: payload.reviewId ?? '', action: status as 'approved' | 'denied' | 'timedOut' | 'aborted' } as CodexEvent)
        break
      }
      case 'serverRequest/resolved': {
        const requestId = (params as { requestId?: string | number }).requestId
        if (requestId !== undefined) {
          this.emit('event', { type: 'server_request_resolved', threadId, requestId } as CodexEvent)
        }
        break
      }
      default:
        break
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(request.method)
    if (!handler) {
      this.writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unsupported Codex server request: ${request.method}` },
      })
      return
    }
    try {
      const result = await handler(request.params ?? {}, { id: request.id, method: request.method })
      this.writeResponse({ jsonrpc: '2.0', id: request.id, result: result ?? null })
    } catch (error) {
      this.writeResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Codex request handler failed',
        },
      })
    }
  }

  private writeResponse(response: JsonRpcResponse): void {
    if (!this.process?.stdin?.writable) return
    this.process.stdin.write(`${JSON.stringify(response)}\n`)
  }

  private describeGuardianAction(action: unknown): string {
    if (!action || typeof action !== 'object') return 'Unknown action'
    const a = action as Record<string, unknown>
    switch (a.type) {
      case 'command':
        return `Run command: ${String(a.command ?? '')}`
      case 'execve':
        return `Execute: ${String(a.program ?? '')} ${Array.isArray(a.argv) ? a.argv.join(' ') : ''}`
      case 'applyPatch':
        return `Apply patch to ${Array.isArray(a.files) ? (a.files as string[]).join(', ') : 'files'}`
      case 'networkAccess':
        return `Network access: ${String(a.protocol ?? '')} ${String(a.host ?? '')}:${String(a.port ?? '')}`
      case 'mcpToolCall':
        return `Tool call: ${String(a.toolName ?? '')}`
      case 'requestPermissions':
        return 'Request additional permissions'
      default:
        return String(a.type ?? 'Unknown action')
    }
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) throw new Error('Codex app-server not running')
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    if (!params) delete notification.params
    this.process.stdin.write(`${JSON.stringify(notification)}\n`)
  }

  private call(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Codex app-server not running'))
        return
      }
      const id = this.nextId++
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server did not respond to ${method} within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.process.stdin.write(JSON.stringify(req) + '\n')
    })
  }
}
