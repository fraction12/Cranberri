import type { CodexServerRequestContext, CodexServerRequestHandler } from '../../shared/codex'
import {
  codexHumanServerRequestResponseSchema,
  codexHumanServerRequestSchema,
  codexRequestIdSchema,
  type CodexHumanServerRequestResponse,
  type CodexPendingHumanServerRequest,
  type CodexRequestId,
} from '../../shared/codex-requests'

export type { CodexPendingHumanServerRequest } from '../../shared/codex-requests'

export const CODEX_HUMAN_SERVER_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
] as const

export type CodexHumanServerRequestMethod = typeof CODEX_HUMAN_SERVER_REQUEST_METHODS[number]

export interface CodexRequestHandlerRegistrar {
  registerRequestHandler(method: string, handler: CodexServerRequestHandler): () => void
}

export type CodexHumanRequestBrokerErrorCode =
  | 'invalid_request'
  | 'invalid_response'
  | 'invalid_resolution'
  | 'duplicate_request'
  | 'method_mismatch'
  | 'capacity'
  | 'timeout'
  | 'cancelled'
  | 'externally_resolved'
  | 'delivery_failed'
  | 'disposed'

export class CodexHumanRequestBrokerError extends Error {
  constructor(
    readonly code: CodexHumanRequestBrokerErrorCode,
    message: string,
    readonly requestId?: CodexRequestId,
  ) {
    super(message)
    this.name = 'CodexHumanRequestBrokerError'
  }
}

export interface CodexHumanServerRequestBrokerOptions {
  onPending: (pending: CodexPendingHumanServerRequest) => void
  onSettled?: (settlement: CodexHumanServerRequestSettlement) => void
  timeoutMs?: number
  maxPending?: number
  maxReplay?: number
  replayTtlMs?: number
  now?: () => number
}

export type CodexHumanServerRequestSettlement = {
  pending: CodexPendingHumanServerRequest
} & (
  | { type: 'response'; response: CodexHumanServerRequestResponse }
  | { type: 'terminal'; code: CodexHumanRequestBrokerErrorCode }
)

interface PendingEntry {
  snapshot: CodexPendingHumanServerRequest
  key: string
  signature: string
  promise: Promise<unknown>
  resolve: (response: unknown) => void
  reject: (error: CodexHumanRequestBrokerError) => void
  timer: ReturnType<typeof setTimeout>
}

interface RequestHistoryEntry {
  attempt: number
  expiresAt: number
  signature: string
  response?: CodexHumanServerRequestResponse
  responseSignature?: string
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_PENDING = 32
const DEFAULT_MAX_REPLAY = 64
const DEFAULT_REPLAY_TTL_MS = 30_000

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function requestKey(id: CodexRequestId): string {
  return `${typeof id}:${String(id)}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function signature(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function formatValidationIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

export class CodexHumanServerRequestBroker {
  private readonly onPending: (pending: CodexPendingHumanServerRequest) => void
  private readonly onSettled?: (settlement: CodexHumanServerRequestSettlement) => void
  private readonly timeoutMs: number
  private readonly maxPending: number
  private readonly maxReplay: number
  private readonly replayTtlMs: number
  private readonly now: () => number
  private readonly pending = new Map<string, PendingEntry>()
  private readonly history = new Map<string, RequestHistoryEntry>()
  private unregisterHandlers: Array<() => void> | null = null
  private disposed = false

  constructor(options: CodexHumanServerRequestBrokerOptions) {
    this.onPending = options.onPending
    this.onSettled = options.onSettled
    this.timeoutMs = assertPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
    this.maxPending = assertPositiveInteger(options.maxPending ?? DEFAULT_MAX_PENDING, 'maxPending')
    this.maxReplay = assertPositiveInteger(options.maxReplay ?? DEFAULT_MAX_REPLAY, 'maxReplay')
    this.replayTtlMs = assertPositiveInteger(options.replayTtlMs ?? DEFAULT_REPLAY_TTL_MS, 'replayTtlMs')
    this.now = options.now ?? Date.now
  }

  get pendingCount(): number {
    return this.pending.size
  }

  listPending(): CodexPendingHumanServerRequest[] {
    return [...this.pending.values()].map((entry) => cloneValue(entry.snapshot))
  }

  register(registrar: CodexRequestHandlerRegistrar): () => void {
    if (this.disposed) throw new CodexHumanRequestBrokerError('disposed', 'Codex request broker is disposed')
    if (this.unregisterHandlers) throw new Error('Codex request broker is already registered')

    const unregisterHandlers: Array<() => void> = []
    try {
      for (const method of CODEX_HUMAN_SERVER_REQUEST_METHODS) {
        unregisterHandlers.push(registrar.registerRequestHandler(
          method,
          (params, context) => this.receive(method, params, context),
        ))
      }
    } catch (error) {
      for (const unregister of unregisterHandlers.reverse()) unregister()
      throw error
    }

    this.unregisterHandlers = unregisterHandlers
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.unregisterHandlers !== unregisterHandlers) return
      for (const unregister of [...unregisterHandlers].reverse()) unregister()
      this.unregisterHandlers = null
      this.cancelAll('Codex request broker unregistered')
    }
  }

  respond(input: unknown): boolean {
    const parsed = codexHumanServerRequestResponseSchema.safeParse(input)
    if (!parsed.success) {
      throw new CodexHumanRequestBrokerError(
        'invalid_response',
        `Invalid Codex server request response: ${formatValidationIssues(parsed.error.issues)}`,
      )
    }

    this.pruneHistory()
    const response = parsed.data
    const key = requestKey(response.id)
    const entry = this.pending.get(key)
    if (!entry) {
      const completed = this.history.get(key)
      return Boolean(
        completed?.response
        && completed.responseSignature === signature(response),
      )
    }
    if (entry.snapshot.request.method !== response.method) {
      throw new CodexHumanRequestBrokerError(
        'method_mismatch',
        `Response method ${response.method} does not match pending request ${entry.snapshot.request.method}`,
        response.id,
      )
    }

    this.pending.delete(key)
    clearTimeout(entry.timer)
    this.remember(entry, cloneValue(response))
    this.notifySettled({ pending: cloneValue(entry.snapshot), type: 'response', response: cloneValue(response) })
    entry.resolve(cloneValue(response.response))
    return true
  }

  cancel(id: CodexRequestId, reason = 'Codex server request cancelled'): boolean {
    const parsedId = codexRequestIdSchema.safeParse(id)
    if (!parsedId.success) return false
    return this.rejectPending(
      requestKey(parsedId.data),
      new CodexHumanRequestBrokerError('cancelled', reason, parsedId.data),
    )
  }

  cancelAll(reason = 'Codex server requests cancelled'): number {
    const ids = [...this.pending.values()].map((entry) => entry.snapshot.request.id)
    for (const id of ids) this.cancel(id, reason)
    return ids.length
  }

  handleServerRequestResolved(input: unknown): boolean {
    if (!input || typeof input !== 'object' || !('requestId' in input)) {
      throw new CodexHumanRequestBrokerError('invalid_resolution', 'Invalid serverRequest/resolved payload')
    }
    const parsedId = codexRequestIdSchema.safeParse((input as { requestId: unknown }).requestId)
    if (!parsedId.success) {
      throw new CodexHumanRequestBrokerError('invalid_resolution', 'Invalid serverRequest/resolved requestId')
    }
    return this.rejectPending(
      requestKey(parsedId.data),
      new CodexHumanRequestBrokerError(
        'externally_resolved',
        'Codex server request was resolved by another client',
        parsedId.data,
      ),
    )
  }

  dispose(): void {
    if (this.disposed) return
    const unregisterHandlers = this.unregisterHandlers
    if (unregisterHandlers) {
      for (const unregister of [...unregisterHandlers].reverse()) unregister()
      this.unregisterHandlers = null
    }
    this.cancelAll('Codex request broker disposed')
    this.history.clear()
    this.disposed = true
  }

  private receive(
    registeredMethod: CodexHumanServerRequestMethod,
    params: Record<string, unknown>,
    context: CodexServerRequestContext,
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new CodexHumanRequestBrokerError('disposed', 'Codex request broker is disposed', context.id))
    }
    if (context.method !== registeredMethod) {
      return Promise.reject(new CodexHumanRequestBrokerError(
        'invalid_request',
        `Codex request method ${context.method} reached handler for ${registeredMethod}`,
        context.id,
      ))
    }

    const parsed = codexHumanServerRequestSchema.safeParse({
      id: context.id,
      method: context.method,
      params,
    })
    if (!parsed.success) {
      return Promise.reject(new CodexHumanRequestBrokerError(
        'invalid_request',
        `Invalid Codex server request: ${formatValidationIssues(parsed.error.issues)}`,
        context.id,
      ))
    }

    this.pruneHistory()
    const request = parsed.data
    const key = requestKey(request.id)
    const requestSignature = signature(request)
    const active = this.pending.get(key)
    if (active) {
      if (active.signature === requestSignature) return active.promise
      return Promise.reject(new CodexHumanRequestBrokerError(
        'duplicate_request',
        'Codex reused an active request id with different request data',
        request.id,
      ))
    }

    const previous = this.history.get(key)
    if (previous?.response) {
      if (previous.signature === requestSignature) return Promise.resolve(cloneValue(previous.response.response))
      return Promise.reject(new CodexHumanRequestBrokerError(
        'duplicate_request',
        'Codex reused a completed request id with different request data',
        request.id,
      ))
    }
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new CodexHumanRequestBrokerError(
        'capacity',
        `Codex human request limit reached (${this.maxPending})`,
        request.id,
      ))
    }

    const receivedAt = this.now()
    const snapshot: CodexPendingHumanServerRequest = {
      request,
      attempt: (previous?.attempt ?? 0) + 1,
      receivedAt,
      deadlineAt: receivedAt + this.timeoutMs,
    }
    let resolve!: (response: unknown) => void
    let reject!: (error: CodexHumanRequestBrokerError) => void
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const entry: PendingEntry = {
      snapshot,
      key,
      signature: requestSignature,
      promise,
      resolve,
      reject,
      timer: setTimeout(() => {
        this.rejectPending(
          key,
          new CodexHumanRequestBrokerError('timeout', 'Codex server request timed out', request.id),
        )
      }, this.timeoutMs),
    }
    this.pending.set(key, entry)

    try {
      this.onPending(cloneValue(snapshot))
    } catch (error) {
      if (this.pending.get(key) === entry) {
        this.rejectPending(key, new CodexHumanRequestBrokerError(
          'delivery_failed',
          error instanceof Error ? error.message : 'Failed to deliver Codex server request',
          request.id,
        ))
      }
    }
    return promise
  }

  private rejectPending(key: string, error: CodexHumanRequestBrokerError): boolean {
    const entry = this.pending.get(key)
    if (!entry) return false
    this.pending.delete(key)
    clearTimeout(entry.timer)
    this.remember(entry)
    this.notifySettled({ pending: cloneValue(entry.snapshot), type: 'terminal', code: error.code })
    entry.reject(error)
    return true
  }

  private notifySettled(settlement: CodexHumanServerRequestSettlement): void {
    try {
      this.onSettled?.(settlement)
    } catch {
      // Persistence/observation must never alter the app-server response lifecycle.
    }
  }

  private remember(entry: PendingEntry, response?: CodexHumanServerRequestResponse): void {
    this.history.delete(entry.key)
    this.history.set(entry.key, {
      attempt: entry.snapshot.attempt,
      expiresAt: this.now() + this.replayTtlMs,
      signature: entry.signature,
      response,
      responseSignature: response ? signature(response) : undefined,
    })
    this.pruneHistory()
  }

  private pruneHistory(): void {
    const now = this.now()
    for (const [key, entry] of this.history) {
      if (entry.expiresAt <= now) this.history.delete(key)
    }
    while (this.history.size > this.maxReplay) {
      const oldest = this.history.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.history.delete(oldest)
    }
  }
}
