import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  lifecycleOperationSchema,
  type LifecycleOperation,
  type LifecycleOperationReceipt,
  type LifecyclePurgeSelectors,
  type RestoreReservation,
  taskSchema,
} from '../shared/tasks'
import { managedWorktreeSchema } from '../shared/worktrees'

export const TASK_STORE_VERSION = 2

const taskStoreV1Schema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().safe().default(0),
  tasks: z.array(taskSchema),
  managedWorktrees: z.array(managedWorktreeSchema),
  localLeaseByProjectId: z.record(z.string(), z.string().nullable()),
  interruptedOperations: z.array(z.record(z.string(), z.unknown())),
})

export const taskStoreSchema = z.object({
  version: z.literal(TASK_STORE_VERSION),
  revision: z.number().int().nonnegative().safe().default(0),
  tasks: z.array(taskSchema),
  managedWorktrees: z.array(managedWorktreeSchema),
  localLeaseByProjectId: z.record(z.string(), z.string().nullable()),
  interruptedOperations: z.array(z.record(z.string(), z.unknown())),
  lifecycleOperations: z.array(lifecycleOperationSchema).default([]),
})

type CurrentTaskStoreState = z.infer<typeof taskStoreSchema>

// The wider input type keeps existing in-memory fixtures source-compatible.
// Every value returned from TaskStore is normalized to the current schema.
export type TaskStoreState = Omit<CurrentTaskStoreState, 'version' | 'lifecycleOperations'> & {
  version: 1 | typeof TASK_STORE_VERSION
  lifecycleOperations?: LifecycleOperation[]
}

export const EMPTY_TASK_STORE: CurrentTaskStoreState = {
  version: TASK_STORE_VERSION,
  revision: 0,
  tasks: [],
  managedWorktrees: [],
  localLeaseByProjectId: {},
  interruptedOperations: [],
  lifecycleOperations: [],
}

export interface TaskStoreCommittedChange {
  revision: number
  affectedIds?: string[]
}

export class TaskStoreCompatibilityError extends Error {
  readonly foundVersion: number
  readonly generationPath: string

  constructor(foundVersion: number, generationPath: string) {
    super(`Task store schema version ${foundVersion} is newer than supported version ${TASK_STORE_VERSION}`)
    this.name = 'TaskStoreCompatibilityError'
    this.foundVersion = foundVersion
    this.generationPath = generationPath
  }
}

interface BeginLifecycleOperationBase {
  taskId: string
  worktreeId: string | null
  startedAt: number
}

export type BeginLifecycleOperation =
  | (BeginLifecycleOperationBase & {
    kind: 'archive'
    artifactId?: string
  })
  | (BeginLifecycleOperationBase & {
    kind: 'restore'
    artifactId: string | null
    restoreReservation: RestoreReservation | null
  })
  | (BeginLifecycleOperationBase & {
    kind: 'delete'
    artifactId: string | null
    purgeSelectors: LifecyclePurgeSelectors
  })

type TaskStoreSubscriber = (change: TaskStoreCommittedChange) => void

interface ValidGeneration {
  source: 'primary' | 'previous'
  bytes: string
  version: 1 | typeof TASK_STORE_VERSION
  revision: number
  state: CurrentTaskStoreState
}

interface AuthorityState {
  bytes: string
  state: CurrentTaskStoreState
}

function changedIds<T extends { id: string }>(before: T[], after: T[]): string[] {
  const beforeById = new Map(before.map((item) => [item.id, JSON.stringify(item)]))
  const afterById = new Map(after.map((item) => [item.id, JSON.stringify(item)]))
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((id) => beforeById.get(id) !== afterById.get(id))
    .sort()
}

function affectedIds(before: CurrentTaskStoreState, after: CurrentTaskStoreState): string[] | undefined {
  const changedOperationIds = new Set(changedIds(before.lifecycleOperations, after.lifecycleOperations))
  const lifecycleIds = [...before.lifecycleOperations, ...after.lifecycleOperations]
    .filter((operation) => changedOperationIds.has(operation.id))
    .flatMap((operation) => [operation.taskId, operation.worktreeId].filter((id): id is string => Boolean(id)))
  const ids = [
    ...changedIds(before.tasks, after.tasks),
    ...changedIds(before.managedWorktrees, after.managedWorktrees),
    ...lifecycleIds,
  ]
  return ids.length ? [...new Set(ids)].sort() : undefined
}

function emptyTaskStore(): CurrentTaskStoreState {
  return structuredClone(EMPTY_TASK_STORE)
}

function serialized(state: CurrentTaskStoreState): string {
  return JSON.stringify(state, null, 2)
}

function migrateV1(state: z.infer<typeof taskStoreV1Schema>): CurrentTaskStoreState {
  return taskStoreSchema.parse({
    ...state,
    version: TASK_STORE_VERSION,
    lifecycleOperations: [],
  })
}

function parsedVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null
  const version = (value as { version?: unknown }).version
  return typeof version === 'number' && Number.isFinite(version) ? version : null
}

export class TaskStore {
  private writes: Promise<void> = Promise.resolve()
  private readonly subscribers = new Set<TaskStoreSubscriber>()

  constructor(private readonly configuredPath?: string) {}

  private targetPath(): string {
    return this.configuredPath ?? path.join(app.getPath('userData'), 'tasks.json')
  }

  private previousPath(): string {
    return `${this.targetPath()}.previous`
  }

  read(): CurrentTaskStoreState {
    try {
      return this.readAuthority().state
    } catch (error) {
      if (error instanceof TaskStoreCompatibilityError) throw error
      throw new Error('Cannot read authoritative task store', { cause: error })
    }
  }

  subscribe(subscriber: TaskStoreSubscriber): () => void {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  update(
    updater: (state: CurrentTaskStoreState) => CurrentTaskStoreState | Promise<CurrentTaskStoreState>,
  ): Promise<CurrentTaskStoreState> {
    let result!: CurrentTaskStoreState
    const operation = this.writes.then(async () => {
      const authority = this.readAuthority()
      const candidate = await updater(authority.state)
      const validated = taskStoreSchema.parse({
        ...candidate,
        version: TASK_STORE_VERSION,
        lifecycleOperations: candidate.lifecycleOperations ?? [],
      })
      if (authority.state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Task store revision exhausted')
      result = { ...validated, revision: authority.state.revision + 1 }
      this.write(result, authority.bytes)
      this.publishChange(authority.state, result)
    })
    this.writes = operation.catch(() => undefined)
    return operation.then(() => result)
  }

  beginLifecycleOperation(input: BeginLifecycleOperation): Promise<LifecycleOperation> {
    let result!: LifecycleOperation
    const operation = this.writes.then(() => {
      const authority = this.readAuthority()
      const active = authority.state.lifecycleOperations.find((candidate) => (
        candidate.status !== 'completed'
        && (candidate.taskId === input.taskId
          || Boolean(input.worktreeId && candidate.worktreeId === input.worktreeId))
      ))
      if (active) {
        if (active.kind === input.kind
          && active.taskId === input.taskId
          && active.worktreeId === input.worktreeId) {
          result = active
          return
        }
        throw new Error(`Cannot begin ${input.kind}; active ${active.kind} operation ${active.id} conflicts`)
      }

      const artifactId = input.kind === 'archive'
        ? input.artifactId ?? randomUUID()
        : input.artifactId
      result = lifecycleOperationSchema.parse({
        id: randomUUID(),
        kind: input.kind,
        taskId: input.taskId,
        worktreeId: input.worktreeId,
        status: 'pending',
        phase: 'intentPersisted',
        receipts: [],
        artifactId,
        restoreReservation: input.kind === 'restore' ? input.restoreReservation : null,
        rpc: null,
        purgeSelectors: input.kind === 'delete' ? input.purgeSelectors : null,
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
        retry: { attempt: 0, retryable: true, nextAttemptAt: null },
        lastError: null,
      })
      if (authority.state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Task store revision exhausted')
      const next = taskStoreSchema.parse({
        ...authority.state,
        revision: authority.state.revision + 1,
        lifecycleOperations: [...authority.state.lifecycleOperations, result],
      })
      this.write(next, authority.bytes)
      this.publishChange(authority.state, next)
    })
    this.writes = operation.catch(() => undefined)
    return operation.then(() => result)
  }

  appendLifecycleReceipt(operationId: string, receipt: LifecycleOperationReceipt): Promise<LifecycleOperation> {
    const validatedReceipt = lifecycleOperationSchema.shape.receipts.element.parse(receipt)
    let result!: LifecycleOperation
    return this.update((state) => ({
      ...state,
      lifecycleOperations: state.lifecycleOperations.map((operation) => {
        if (operation.id !== operationId) return operation
        const existing = validatedReceipt.receiptId
          ? operation.receipts.find((candidate) => candidate.receiptId === validatedReceipt.receiptId)
          : operation.receipts.find((candidate) => JSON.stringify(candidate) === JSON.stringify(validatedReceipt))
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(validatedReceipt)) {
            throw new Error(`Lifecycle receipt ${validatedReceipt.receiptId} conflicts with durable authority`)
          }
          result = operation
          return operation
        }
        result = lifecycleOperationSchema.parse({
          ...operation,
          receipts: [...operation.receipts, validatedReceipt],
          updatedAt: Math.max(operation.updatedAt, validatedReceipt.recordedAt),
        })
        return result
      }),
    })).then(() => {
      if (!result) throw new Error('Lifecycle operation not found')
      return result
    })
  }

  updateLifecycleOperation(
    operationId: string,
    updater: (operation: LifecycleOperation) => LifecycleOperation,
  ): Promise<LifecycleOperation> {
    let result!: LifecycleOperation
    return this.update((state) => ({
      ...state,
      lifecycleOperations: state.lifecycleOperations.map((operation) => {
        if (operation.id !== operationId) return operation
        result = lifecycleOperationSchema.parse(updater(operation))
        return result
      }),
    })).then(() => {
      if (!result) throw new Error('Lifecycle operation not found')
      return result
    })
  }

  private publishChange(before: CurrentTaskStoreState, after: CurrentTaskStoreState): void {
    const changed = affectedIds(before, after)
    const change: TaskStoreCommittedChange = {
      revision: after.revision,
      ...(changed ? { affectedIds: changed } : {}),
    }
    for (const subscriber of this.subscribers) {
      try {
        subscriber(change)
      } catch (error) {
        console.error('Task store subscriber failed:', error)
      }
    }
  }

  private readAuthority(): AuthorityState {
    const targetPath = this.targetPath()
    const previousPath = this.previousPath()
    const existingPaths = [targetPath, previousPath].filter((candidate) => fs.existsSync(candidate))
    if (existingPaths.length === 0) {
      const state = emptyTaskStore()
      return { state, bytes: serialized(state) }
    }

    const generations = existingPaths.flatMap((generationPath) => {
      const source = generationPath === targetPath ? 'primary' as const : 'previous' as const
      const inspected = this.inspectGeneration(generationPath, source)
      return inspected ? [inspected] : []
    })
    if (generations.length === 0) throw new Error('No valid task store generation')

    generations.sort((left, right) => (
      right.revision - left.revision
      || right.version - left.version
      || (left.source === 'primary' ? -1 : 1)
    ))
    const selected = generations[0]
    if (!selected) throw new Error('No valid task store generation')
    if (selected.version === TASK_STORE_VERSION) {
      return { state: selected.state, bytes: selected.bytes }
    }

    const migrated = migrateV1(taskStoreV1Schema.parse(JSON.parse(selected.bytes)))
    this.write(migrated, selected.bytes)
    return { state: migrated, bytes: serialized(migrated) }
  }

  private inspectGeneration(
    generationPath: string,
    source: ValidGeneration['source'],
  ): ValidGeneration | null {
    const bytes = fs.readFileSync(generationPath, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(bytes)
    } catch {
      return null
    }
    const version = parsedVersion(value)
    if (version !== null && version > TASK_STORE_VERSION) {
      throw new TaskStoreCompatibilityError(version, generationPath)
    }
    if (version === 1) {
      const parsed = taskStoreV1Schema.safeParse(value)
      return parsed.success
        ? { source, bytes, version: 1, revision: parsed.data.revision, state: migrateV1(parsed.data) }
        : null
    }
    if (version === TASK_STORE_VERSION) {
      const parsed = taskStoreSchema.safeParse(value)
      return parsed.success
        ? { source, bytes, version: TASK_STORE_VERSION, revision: parsed.data.revision, state: parsed.data }
        : null
    }
    return null
  }

  private write(state: CurrentTaskStoreState, previousBytes: string): void {
    const targetPath = this.targetPath()
    const previousPath = this.previousPath()
    const parentPath = path.dirname(targetPath)
    fs.mkdirSync(parentPath, { recursive: true, mode: 0o700 })

    this.writeGeneration(previousPath, previousBytes, parentPath)
    const backup = this.inspectGeneration(previousPath, 'previous')
    if (!backup || backup.bytes !== previousBytes) {
      throw new Error('Cannot validate previous task store generation')
    }
    this.writeGeneration(targetPath, serialized(state), parentPath)
  }

  private writeGeneration(destination: string, bytes: string, parentPath: string): void {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    let descriptor: number | null = null
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(descriptor, bytes, { encoding: 'utf8' })
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = null
      fs.renameSync(temporary, destination)
      this.flushDirectory(parentPath)
    } catch (error) {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor)
        } catch {
          // The original persistence error remains authoritative.
        }
      }
      if (fs.existsSync(temporary)) {
        try {
          execFileSync('/usr/bin/trash', [temporary], { stdio: 'ignore' })
        } catch {
          // Preserve the temporary file when recoverable cleanup is unavailable.
        }
      }
      throw error
    }
  }

  private flushDirectory(directoryPath: string): void {
    const descriptor = fs.openSync(directoryPath, 'r')
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
  }
}
