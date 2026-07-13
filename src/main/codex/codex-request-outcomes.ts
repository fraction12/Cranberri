import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  codexHumanServerRequestResponseSchema,
  codexHumanServerRequestSchema,
  codexRequestOutcomeEntrySchema,
  type CodexHumanServerRequest,
  type CodexHumanServerRequestResponse,
  type CodexRequestOutcomeEntry,
} from '../../shared/codex-requests'

export { codexRequestOutcomeEntrySchema }
export type { CodexRequestOutcomeEntry }

export const CODEX_REQUEST_OUTCOME_LIMITS = {
  entries: 512,
  bytes: 128 * 1024,
  identifier: 512,
} as const

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function createStoreSchema(maxEntries: number, maxBytes: number) {
  return z.object({
    version: z.literal(1),
    entries: z.array(codexRequestOutcomeEntrySchema).max(maxEntries),
  }).strict().superRefine((value, context) => {
    if (serializedBytes(value) > maxBytes) {
      context.addIssue({
        code: 'custom',
        message: `Codex request outcome ledger exceeds ${maxBytes} serialized bytes`,
      })
    }
  })
}

export const codexRequestOutcomeStoreSchema = createStoreSchema(
  CODEX_REQUEST_OUTCOME_LIMITS.entries,
  CODEX_REQUEST_OUTCOME_LIMITS.bytes,
)

export type CodexRequestOutcomeStore = z.infer<typeof codexRequestOutcomeStoreSchema>

type OutcomeTerminalStatus = 'declined' | 'cancelled' | 'failed' | 'external'

interface OutcomeRecordBase {
  request: CodexHumanServerRequest
  attempt: number
  receivedAt: number
  completedAt?: number
}

export type RecordCodexRequestOutcomeInput = OutcomeRecordBase & (
  | { response: CodexHumanServerRequestResponse; status?: never }
  | { status: OutcomeTerminalStatus; response?: never }
)

export interface CodexRequestOutcomeReadResult {
  store: CodexRequestOutcomeStore
  source: 'primary' | 'backup' | 'default'
}

export interface CodexRequestOutcomeFileSystem {
  existsSync(filePath: string): boolean
  mkdirSync(directoryPath: string, options: { recursive: true }): unknown
  readFileSync(filePath: string, encoding: 'utf8'): string
  writeFileSync(filePath: string, bytes: string): unknown
  renameSync(from: string, to: string): unknown
}

export interface CodexRequestOutcomeLedgerOptions {
  filePath: string
  fileSystem?: CodexRequestOutcomeFileSystem
  now?: () => number
  maxEntries?: number
  maxBytes?: number
}

function backupPath(target: string): string {
  return `${target}.last-good`
}

function emptyStore(): CodexRequestOutcomeStore {
  return { version: 1, entries: [] }
}

function requestIdentity(envelope: Pick<CodexHumanServerRequest, 'id' | 'method'>): string {
  return `${envelope.method}:${typeof envelope.id}:${String(envelope.id)}`
}

function entryIdentity(entry: CodexRequestOutcomeEntry): string {
  return [
    entry.method,
    typeof entry.requestId,
    String(entry.requestId),
    entry.threadId,
    entry.turnId ?? '',
    entry.itemId ?? '',
  ].join(':')
}

function requestLocation(request: CodexHumanServerRequest): {
  threadId: string
  turnId: string | null
  itemId: string | null
  requestedAt: number | null
} {
  if (request.method === 'mcpServer/elicitation/request') {
    return {
      threadId: request.params.threadId,
      turnId: request.params.turnId,
      itemId: null,
      requestedAt: null,
    }
  }

  return {
    threadId: request.params.threadId,
    turnId: request.params.turnId,
    itemId: request.params.itemId,
    requestedAt: 'startedAtMs' in request.params ? request.params.startedAtMs : null,
  }
}

function permissionCount(response: Extract<
  CodexHumanServerRequestResponse,
  { method: 'item/permissions/requestApproval' }
>): number {
  return Number(response.response.permissions.network !== undefined)
    + Number(response.response.permissions.fileSystem !== undefined)
}

function summarizeResponse(response: CodexHumanServerRequestResponse): Pick<
  CodexRequestOutcomeEntry,
  'status' | 'decision'
> {
  if (response.method === 'item/commandExecution/requestApproval') {
    const { decision } = response.response
    if (decision === 'decline') {
      return { status: 'declined', decision: { kind: 'declined', scope: 'request', count: 1 } }
    }
    if (decision === 'cancel') {
      return { status: 'cancelled', decision: { kind: 'cancelled', scope: 'request', count: 1 } }
    }
    if (decision === 'acceptForSession') {
      return { status: 'resolved', decision: { kind: 'accepted', scope: 'session', count: 1 } }
    }
    if (decision === 'accept') {
      return { status: 'resolved', decision: { kind: 'accepted', scope: 'request', count: 1 } }
    }
    if ('acceptWithExecpolicyAmendment' in decision) {
      return {
        status: 'resolved',
        decision: {
          kind: 'execpolicy_amendment',
          scope: 'session',
          count: decision.acceptWithExecpolicyAmendment.execpolicy_amendment.length,
        },
      }
    }
    return {
      status: 'resolved',
      decision: { kind: 'network_policy_amendment', scope: 'session', count: 1 },
    }
  }

  if (response.method === 'item/fileChange/requestApproval') {
    const { decision } = response.response
    if (decision === 'decline') {
      return { status: 'declined', decision: { kind: 'declined', scope: 'request', count: 1 } }
    }
    if (decision === 'cancel') {
      return { status: 'cancelled', decision: { kind: 'cancelled', scope: 'request', count: 1 } }
    }
    return {
      status: 'resolved',
      decision: {
        kind: 'accepted',
        scope: decision === 'acceptForSession' ? 'session' : 'request',
        count: 1,
      },
    }
  }

  if (response.method === 'item/permissions/requestApproval') {
    return {
      status: 'resolved',
      decision: {
        kind: 'permissions_granted',
        scope: response.response.scope,
        count: permissionCount(response),
      },
    }
  }

  if (response.method === 'item/tool/requestUserInput') {
    return {
      status: 'resolved',
      decision: {
        kind: 'answered',
        scope: 'request',
        count: Object.keys(response.response.answers).length,
      },
    }
  }

  if (response.response.action === 'decline') {
    return { status: 'declined', decision: { kind: 'declined', scope: 'request', count: 1 } }
  }
  if (response.response.action === 'cancel') {
    return { status: 'cancelled', decision: { kind: 'cancelled', scope: 'request', count: 1 } }
  }
  return { status: 'resolved', decision: { kind: 'accepted', scope: 'request', count: 1 } }
}

function summarizeTerminalStatus(status: OutcomeTerminalStatus): Pick<
  CodexRequestOutcomeEntry,
  'status' | 'decision'
> {
  return {
    status,
    decision: { kind: status, scope: 'request', count: 1 },
  }
}

function assertCorrelatedResponse(
  request: CodexHumanServerRequest,
  response: CodexHumanServerRequestResponse,
): void {
  if (request.method !== response.method || requestIdentity(request) !== requestIdentity(response)) {
    throw new Error('Codex request outcome response does not match its request')
  }
}

export class CodexRequestOutcomeLedger {
  private readonly target: string
  private readonly fileSystem: CodexRequestOutcomeFileSystem
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly storeSchema: ReturnType<typeof createStoreSchema>

  constructor(options: CodexRequestOutcomeLedgerOptions) {
    this.target = z.string().min(1).parse(options.filePath)
    this.fileSystem = options.fileSystem ?? fs
    this.now = options.now ?? Date.now
    this.maxEntries = z.number().int().positive().parse(
      options.maxEntries ?? CODEX_REQUEST_OUTCOME_LIMITS.entries,
    )
    this.maxBytes = z.number().int().positive().parse(
      options.maxBytes ?? CODEX_REQUEST_OUTCOME_LIMITS.bytes,
    )
    this.storeSchema = createStoreSchema(this.maxEntries, this.maxBytes)
  }

  read(): CodexRequestOutcomeReadResult {
    const backup = backupPath(this.target)
    if (!this.fileSystem.existsSync(this.target) && !this.fileSystem.existsSync(backup)) {
      return { store: emptyStore(), source: 'default' }
    }

    let primaryError: unknown
    if (this.fileSystem.existsSync(this.target)) {
      try {
        return { store: this.readCandidate(this.target), source: 'primary' }
      } catch (error) {
        primaryError = error
      }
    }

    if (this.fileSystem.existsSync(backup)) {
      try {
        return { store: this.readCandidate(backup), source: 'backup' }
      } catch (backupError) {
        throw new Error('Cannot read Codex request outcome ledger primary or backup', {
          cause: backupError,
        })
      }
    }

    throw new Error('Cannot read Codex request outcome ledger primary or backup', {
      cause: primaryError,
    })
  }

  listByThread(threadId: string): CodexRequestOutcomeEntry[] {
    const parsedThreadId = z.string().min(1).max(CODEX_REQUEST_OUTCOME_LIMITS.identifier).parse(threadId)
    return this.read().store.entries
      .filter((entry) => entry.threadId === parsedThreadId)
      .sort((left, right) => right.completedAt - left.completedAt)
  }

  record(input: RecordCodexRequestOutcomeInput): CodexRequestOutcomeEntry {
    const request = codexHumanServerRequestSchema.parse(input.request)
    const attempt = z.number().int().positive().parse(input.attempt)
    const receivedAt = z.number().int().nonnegative().parse(input.receivedAt)
    const completedAt = z.number().int().nonnegative().parse(input.completedAt ?? this.now())
    const location = requestLocation(request)
    let summary: Pick<CodexRequestOutcomeEntry, 'status' | 'decision'>

    if ('response' in input && input.response !== undefined) {
      const response = codexHumanServerRequestResponseSchema.parse(input.response)
      assertCorrelatedResponse(request, response)
      summary = summarizeResponse(response)
    } else {
      summary = summarizeTerminalStatus(input.status)
    }

    const entry = codexRequestOutcomeEntrySchema.parse({
      requestId: request.id,
      method: request.method,
      threadId: location.threadId,
      turnId: location.turnId,
      itemId: location.itemId,
      ...summary,
      requestedAt: location.requestedAt ?? receivedAt,
      completedAt,
      attempt,
    })
    const current = this.read().store.entries
    const identity = entryIdentity(entry)
    const next = current.filter((candidate) => entryIdentity(candidate) !== identity)
    next.push(entry)
    this.write({ version: 1, entries: next })
    return entry
  }

  pruneThread(threadId: string): number {
    const parsedThreadId = z.string().min(1).max(CODEX_REQUEST_OUTCOME_LIMITS.identifier).parse(threadId)
    const current = this.read().store.entries
    const retained = current.filter((entry) => entry.threadId !== parsedThreadId)
    const removed = current.length - retained.length
    if (removed > 0) this.write({ version: 1, entries: retained })
    return removed
  }

  private readCandidate(filePath: string): CodexRequestOutcomeStore {
    return this.storeSchema.parse(JSON.parse(this.fileSystem.readFileSync(filePath, 'utf8')))
  }

  private compact(store: CodexRequestOutcomeStore): CodexRequestOutcomeStore {
    const entries = [...store.entries]
      .sort((left, right) => left.completedAt - right.completedAt)
      .slice(-this.maxEntries)
    let compacted: CodexRequestOutcomeStore = { version: 1, entries }
    while (entries.length > 0 && serializedBytes(compacted) > this.maxBytes) {
      entries.shift()
      compacted = { version: 1, entries }
    }
    return this.storeSchema.parse(compacted)
  }

  private write(store: CodexRequestOutcomeStore): CodexRequestOutcomeStore {
    const parsed = this.compact(store)
    const nonce = `${process.pid}.${this.now()}.${Math.random().toString(36).slice(2)}`
    const temporary = `${this.target}.${nonce}.tmp`
    const backup = backupPath(this.target)
    const backupTemporary = `${backup}.${nonce}.tmp`
    this.fileSystem.mkdirSync(path.dirname(this.target), { recursive: true })
    this.fileSystem.writeFileSync(temporary, JSON.stringify(parsed))

    if (this.fileSystem.existsSync(this.target)) {
      const previous = this.fileSystem.readFileSync(this.target, 'utf8')
      let previousIsValid = false
      try {
        this.storeSchema.parse(JSON.parse(previous))
        previousIsValid = true
      } catch {
        // A corrupt primary must never replace the last-known-good backup.
      }
      if (previousIsValid) {
        this.fileSystem.writeFileSync(backupTemporary, previous)
        this.fileSystem.renameSync(backupTemporary, backup)
      }
    }

    this.fileSystem.renameSync(temporary, this.target)
    return parsed
  }
}
