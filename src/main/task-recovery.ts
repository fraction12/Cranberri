import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  LifecycleOperation,
  LifecycleOperationKind,
  LifecycleRpcOutcome,
  Task,
} from '../shared/tasks'
import type { ManagedWorktree } from '../shared/worktrees'
import type {
  CodexThreadLifecycleGateway,
  ThreadLifecycleInspection,
} from './codex/thread-lifecycle'
import type { TaskStore } from './task-store'
import type { WorktreeLifecycle } from './worktree-lifecycle'
import type { WorktreeSnapshotStore } from './worktree-snapshot-store'

type HandoffPhase = NonNullable<Task['handoff']>['phase']

export type HandoffRecoveryCommand = 'rollback' | 'discard'

export interface HandoffRecoveryRecommendation {
  taskId: string
  phase: HandoffPhase
  command: HandoffRecoveryCommand
}

export interface TaskRecoveryResult {
  changed: boolean
  revision: number
  repairedTaskIds: string[]
  handoffRecoveries: HandoffRecoveryRecommendation[]
  lifecycleRecoveries: LifecycleRecoveryOutcome[]
}

type RecoveryWorktrees = Pick<WorktreeLifecycle,
  | 'prepareArchive'
  | 'removePreparedArchive'
  | 'restorePreparedArchive'
  | 'retireRestoredSnapshot'
  | 'purgeOwnedArtifacts'
  | 'purgeArchiveQuarantine'
>

export type LegacyArchiveInspection = 'clear' | 'ignored' | 'unsafe'

export interface TaskRecoveryDependencies {
  codex: CodexThreadLifecycleGateway
  worktrees?: RecoveryWorktrees
  snapshotStore?: WorktreeSnapshotStore
  repositoryPath?: (projectId: string) => string
  restoreEnvironment?: (task: Task, worktree: ManagedWorktree, revision: string) => Promise<void>
  inspectLegacyArchive?: (worktree: ManagedWorktree) => Promise<LegacyArchiveInspection>
}

export type LifecycleRecoveryReason =
  | 'operationCompleted'
  | 'ignoredContent'
  | 'unsafeLegacyArchive'
  | 'threadMissing'
  | 'threadUnchecked'
  | 'executorBlocked'
  | 'authorityMismatch'

export interface LifecycleRecoveryOutcome {
  taskId: string
  operationId: string | null
  kind: LifecycleOperationKind | 'legacyArchive'
  status: 'repaired' | 'needsAttention'
  reason: LifecycleRecoveryReason
  threadState: ThreadLifecycleInspection['state'] | null
  message: string
}

type ThreadRecoveryDecision = 'request' | 'observed' | 'needsAttention'
type TaskStoreRead = ReturnType<TaskStore['read']>

class LifecycleRecoveryError extends Error {
  constructor(
    readonly reason: LifecycleRecoveryReason,
    message: string,
    readonly threadState: ThreadLifecycleInspection['state'] | null = null,
  ) {
    super(message)
    this.name = 'LifecycleRecoveryError'
  }
}

export function classifyThreadForOperation(
  kind: LifecycleOperationKind,
  threadState: ThreadLifecycleInspection['state'],
): ThreadRecoveryDecision {
  if (kind === 'archive') {
    if (threadState === 'archived') return 'observed'
    return threadState === 'active' ? 'request' : 'needsAttention'
  }
  if (kind === 'restore') {
    if (threadState === 'active') return 'observed'
    return threadState === 'archived' ? 'request' : 'needsAttention'
  }
  return threadState === 'missing' ? 'observed' : 'request'
}

export function handoffRecoveryCommand(phase: HandoffPhase): HandoffRecoveryCommand {
  if (phase === 'preflight' || phase === 'captured') return 'discard'
  return 'rollback'
}

function interruptedHandoffs(tasks: Task[]): HandoffRecoveryRecommendation[] {
  return tasks.flatMap((task) => {
    if (!task.handoff || (task.state !== 'handingOff' && task.state !== 'needsAttention')) return []
    return [{
      taskId: task.id,
      phase: task.handoff.phase,
      command: handoffRecoveryCommand(task.handoff.phase),
    }]
  })
}

function recoverTask(
  task: Task,
  interruptedTaskIds: ReadonlySet<string>,
  now: number,
  transitionWorktree: ManagedWorktree | undefined,
): Task {
  if (task.worktreeTransition) {
    if (task.location === 'local' && !task.worktreeId) {
      if (transitionWorktree) {
        return {
          ...task,
          checkoutId: transitionWorktree.checkoutId,
          worktreeId: transitionWorktree.id,
          location: 'worktree',
          state: 'needsAttention',
          baseSha: transitionWorktree.baseSha,
          worktreeTransition: {
            ...task.worktreeTransition,
            phase: 'needsAttention',
            error: 'Cranberri restarted after creating the worktree but before binding the session.',
          },
          updatedAt: now,
        }
      }
      return {
        ...task,
        checkoutId: task.worktreeTransition.previousCheckoutId,
        state: 'local',
        baseRef: task.worktreeTransition.previousBaseRef,
        baseSha: task.worktreeTransition.previousBaseSha,
        environmentId: task.worktreeTransition.previousEnvironmentId,
        environmentRevision: task.worktreeTransition.previousEnvironmentRevision,
        worktreeTransition: null,
        updatedAt: now,
      }
    }
    return {
      ...task,
      state: 'needsAttention',
      worktreeTransition: {
        ...task.worktreeTransition,
        phase: 'needsAttention',
        error: task.worktreeTransition.error ?? 'Cranberri restarted while moving this session into a worktree.',
      },
      updatedAt: now,
    }
  }
  if (task.state === 'handingOff' || Boolean(task.handoff && task.state === 'needsAttention') || interruptedTaskIds.has(task.id)) {
    if (task.handoff) {
      return task
    }
    return {
      ...task,
      state: 'needsAttention',
      updatedAt: now,
    }
  }
  if (task.state === 'provisioning') {
    return { ...task, state: 'draft', updatedAt: now }
  }
  if (task.state === 'setup') {
    return { ...task, state: 'failed', updatedAt: now }
  }
  if (task.threadId && task.pendingFirstTurn?.delivery === 'pending') {
    return { ...task, threadId: null, updatedAt: now }
  }
  return task
}

function recoveredState(
  state: ReturnType<TaskStore['read']>,
  now: number,
): ReturnType<TaskStore['read']> {
  const interruptedTaskIds = new Set(state.interruptedOperations.flatMap((operation) => (
    typeof operation.taskId === 'string' ? [operation.taskId] : []
  )))
  const transitionWorktrees = new Map(state.managedWorktrees
    .filter((worktree) => worktree.taskId && worktree.lifecycle !== 'removed')
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .map((worktree) => [worktree.taskId!, worktree]))
  const tasks = state.tasks
    .filter((task) => task.role !== 'control' || Boolean(task.threadId))
    .map((task) => recoverTask(
      task.role === 'control' ? { ...task, role: 'root' as const } : task,
      interruptedTaskIds,
      now,
      transitionWorktrees.get(task.id),
    ))
  const retainedHandoffLeases = new Map(state.tasks.flatMap((task) => (
    task.handoff && (task.state === 'handingOff' || task.state === 'needsAttention')
      ? [[task.projectId, task.id] as const]
      : []
  )))
  const localLeaseByProjectId = Object.fromEntries(
    [...new Set([...Object.keys(state.localLeaseByProjectId), ...retainedHandoffLeases.keys()])]
      .map((projectId) => [projectId, retainedHandoffLeases.get(projectId) ?? null]),
  )
  const managedWorktrees = state.managedWorktrees.map((worktree) => {
    if (worktree.lifecycle === 'removed' || fs.existsSync(worktree.path)) return worktree
    return {
      ...worktree,
      lifecycle: 'needsAttention' as const,
      cleanupReason: 'Managed worktree path was unavailable when Cranberri restarted.',
      updatedAt: now,
    }
  })
  return { ...state, tasks, managedWorktrees, localLeaseByProjectId, interruptedOperations: [] }
}

function changedTaskIds(
  before: ReturnType<TaskStore['read']>,
  after: ReturnType<TaskStore['read']>,
): string[] {
  const beforeById = new Map(before.tasks.map((task) => [task.id, JSON.stringify(task)]))
  const afterById = new Map(after.tasks.map((task) => [task.id, JSON.stringify(task)]))
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((id) => beforeById.get(id) !== afterById.get(id))
    .sort()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function readGitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: null }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

export async function inspectLegacyArchive(
  worktree: ManagedWorktree,
): Promise<LegacyArchiveInspection> {
  try {
    if (!fs.existsSync(worktree.path) || !fs.existsSync(worktree.manifestPath)) return 'unsafe'
    const root = fs.realpathSync(worktree.recordedRoot)
    const checkoutPath = fs.realpathSync(worktree.path)
    const relativeCheckout = path.relative(root, checkoutPath)
    if (!relativeCheckout || relativeCheckout.startsWith('..') || path.isAbsolute(relativeCheckout)) return 'unsafe'

    const manifestPath = fs.realpathSync(worktree.manifestPath)
    const relativeManifest = path.relative(root, manifestPath)
    if (!relativeManifest || relativeManifest.startsWith('..') || path.isAbsolute(relativeManifest)) return 'unsafe'
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    if (manifest.worktreeId !== worktree.id
      || manifest.projectId !== worktree.projectId
      || manifest.taskId !== worktree.taskId
      || path.resolve(String(manifest.checkoutPath ?? '')) !== path.resolve(worktree.path)
      || path.resolve(String(manifest.gitCommonDir ?? '')) !== path.resolve(worktree.gitCommonDir)) {
      return 'unsafe'
    }

    const commonDir = (await readGitBuffer(checkoutPath, [
      'rev-parse', '--path-format=absolute', '--git-common-dir',
    ])).toString('utf8').trim()
    if (fs.realpathSync(commonDir) !== fs.realpathSync(worktree.gitCommonDir)) return 'unsafe'
    const ignored = await readGitBuffer(checkoutPath, [
      'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory',
    ])
    return ignored.length > 0 ? 'ignored' : 'clear'
  } catch {
    return 'unsafe'
  }
}

async function updateIfChanged(
  store: TaskStore,
  updater: (state: TaskStoreRead) => TaskStoreRead,
): Promise<boolean> {
  const before = store.read()
  const candidate = updater(before)
  if (JSON.stringify(candidate) === JSON.stringify(before)) return false
  await store.update(updater)
  return true
}

function operationAction(kind: LifecycleOperationKind): LifecycleRpcOutcome['action'] {
  return kind === 'archive' ? 'archiveThread' : kind === 'restore' ? 'unarchiveThread' : 'deleteThread'
}

function requestedPhase(kind: LifecycleOperationKind): LifecycleOperation['phase'] {
  return kind === 'archive' ? 'threadArchiveRequested'
    : kind === 'restore' ? 'threadUnarchiveRequested'
      : 'threadDeleteRequested'
}

function observedPhase(kind: LifecycleOperationKind): LifecycleOperation['phase'] {
  return kind === 'archive' ? 'threadArchived'
    : kind === 'restore' ? 'threadUnarchived'
      : 'threadDeleted'
}

async function appendReceiptOnce(
  store: TaskStore,
  operationId: string,
  receipt: Parameters<TaskStore['appendLifecycleReceipt']>[1],
): Promise<void> {
  const operation = store.read().lifecycleOperations.find((candidate) => candidate.id === operationId)
  if (!operation) throw new Error('Lifecycle operation not found')
  if (receipt.receiptId && operation.receipts.some((candidate) => candidate.receiptId === receipt.receiptId)) return
  await store.appendLifecycleReceipt(operationId, receipt)
}

async function recordRpcRequested(
  store: TaskStore,
  operationId: string,
  kind: LifecycleOperationKind,
  threadId: string,
  now: number,
): Promise<void> {
  const action = operationAction(kind)
  const operation = store.read().lifecycleOperations.find((candidate) => candidate.id === operationId)
  if (!operation) throw new Error('Lifecycle operation not found')
  if (operation.rpc && operation.rpc.action !== action) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Lifecycle RPC action does not match its durable operation')
  }
  if (!operation.rpc) {
    await store.updateLifecycleOperation(operationId, (candidate) => ({
      ...candidate,
      status: 'running',
      phase: requestedPhase(kind),
      rpc: { action, status: 'requested', requestedAt: now, observedAt: null },
      updatedAt: now,
      lastError: null,
    }))
  }
  await appendReceiptOnce(store, operationId, {
    phase: requestedPhase(kind),
    subphase: 'rpcRequested',
    recordedAt: operation.rpc?.requestedAt ?? now,
    receiptId: `${operationId}:rpcRequested:${action}`,
    details: { rpcRequestId: operationId, threadId },
  })
}

async function recordRpcUnknown(
  store: TaskStore,
  operationId: string,
  message: string,
  now: number,
): Promise<void> {
  await updateIfChanged(store, (state) => ({
    ...state,
    lifecycleOperations: state.lifecycleOperations.map((operation) => {
      if (operation.id !== operationId) return operation
      const nextError = { code: 'CODEX_RPC_UNKNOWN', message, recordedAt: now }
      if (operation.status === 'needsAttention'
        && operation.phase === 'needsAttention'
        && operation.rpc?.status === 'unknown'
        && operation.lastError?.code === nextError.code
        && operation.lastError.message === message) return operation
      return {
        ...operation,
        status: 'needsAttention' as const,
        phase: 'needsAttention' as const,
        rpc: operation.rpc ? { ...operation.rpc, status: 'unknown' as const, observedAt: null } : null,
        updatedAt: now,
        lastError: nextError,
      }
    }),
  }))
}

async function recordRpcObserved(
  store: TaskStore,
  operationId: string,
  kind: LifecycleOperationKind,
  threadId: string,
  now: number,
): Promise<void> {
  const action = operationAction(kind)
  const operation = store.read().lifecycleOperations.find((candidate) => candidate.id === operationId)
  if (!operation) throw new Error('Lifecycle operation not found')
  if (operation.rpc?.action && operation.rpc.action !== action) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Lifecycle RPC action does not match its durable operation')
  }
  if (operation.rpc?.status !== 'observed') {
    await store.updateLifecycleOperation(operationId, (candidate) => ({
      ...candidate,
      status: 'running',
      phase: observedPhase(kind),
      rpc: {
        action,
        status: 'observed',
        requestedAt: candidate.rpc?.requestedAt ?? candidate.startedAt,
        observedAt: now,
      },
      updatedAt: now,
      lastError: null,
    }))
  }
  await appendReceiptOnce(store, operationId, {
    phase: observedPhase(kind),
    subphase: 'rpcObserved',
    recordedAt: operation.rpc?.observedAt ?? now,
    receiptId: `${operationId}:rpcObserved:${action}`,
    details: { rpcRequestId: operationId, threadId },
  })
}

async function requestThreadLifecycle(
  store: TaskStore,
  operation: LifecycleOperation,
  threadId: string,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<void> {
  await recordRpcRequested(store, operation.id, operation.kind, threadId, now)
  try {
    if (operation.kind === 'archive') await dependencies.codex.archiveThread(threadId)
    else if (operation.kind === 'restore') await dependencies.codex.unarchiveThread(threadId)
    else await dependencies.codex.deleteThread(threadId)
  } catch (error) {
    const message = errorMessage(error, `Codex ${operationAction(operation.kind)} outcome is unknown`)
    await recordRpcUnknown(store, operation.id, message, now)
    throw new LifecycleRecoveryError('threadUnchecked', message)
  }
}

async function reconcileThreadLifecycle(
  store: TaskStore,
  operation: LifecycleOperation,
  threadId: string | null,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<ThreadLifecycleInspection['state'] | null> {
  if (!threadId) return null
  let inspection: ThreadLifecycleInspection
  try {
    inspection = await dependencies.codex.inspectThreadLifecycle(threadId)
  } catch (error) {
    throw new LifecycleRecoveryError(
      'threadUnchecked',
      errorMessage(error, 'Codex thread lifecycle could not be inspected'),
    )
  }
  const decision = classifyThreadForOperation(operation.kind, inspection.state)
  if (decision === 'needsAttention') {
    throw new LifecycleRecoveryError(
      'threadMissing',
      `Codex thread ${threadId} is missing while reconciling ${operation.kind}`,
      inspection.state,
    )
  }
  if (decision === 'observed') {
    await recordRpcObserved(store, operation.id, operation.kind, threadId, now)
    return inspection.state
  }
  if (operation.rpc?.status === 'observed') {
    throw new LifecycleRecoveryError(
      'authorityMismatch',
      `Codex thread state contradicts the observed ${operation.kind} outcome`,
      inspection.state,
    )
  }

  await requestThreadLifecycle(store, operation, threadId, dependencies, now)
  let after: ThreadLifecycleInspection
  try {
    after = await dependencies.codex.inspectThreadLifecycle(threadId)
  } catch (error) {
    const message = errorMessage(error, 'Codex thread lifecycle could not be verified after retry')
    await recordRpcUnknown(store, operation.id, message, now)
    throw new LifecycleRecoveryError('threadUnchecked', message)
  }
  if (classifyThreadForOperation(operation.kind, after.state) !== 'observed') {
    const message = `Codex thread did not reach the requested ${operation.kind} state`
    await recordRpcUnknown(store, operation.id, message, now)
    throw new LifecycleRecoveryError('authorityMismatch', message, after.state)
  }
  await recordRpcObserved(store, operation.id, operation.kind, threadId, now)
  return after.state
}

function requireWorktreeRecovery(
  dependencies: TaskRecoveryDependencies,
): asserts dependencies is TaskRecoveryDependencies & {
  worktrees: RecoveryWorktrees
  snapshotStore: WorktreeSnapshotStore
  repositoryPath: (projectId: string) => string
} {
  if (!dependencies.worktrees || !dependencies.snapshotStore || !dependencies.repositoryPath) {
    throw new LifecycleRecoveryError(
      'executorBlocked',
      'Managed worktree recovery executors are unavailable during startup',
    )
  }
}

async function markOperationBlocked(
  store: TaskStore,
  operationId: string,
  reason: LifecycleRecoveryReason,
  message: string,
  now: number,
  taskState: 'needsAttention' | 'cleanupBlocked' = 'needsAttention',
): Promise<void> {
  await updateIfChanged(store, (state) => {
    const operation = state.lifecycleOperations.find((candidate) => candidate.id === operationId)
    if (!operation) return state
    const code = reason === 'threadMissing' ? 'THREAD_MISSING'
      : reason === 'threadUnchecked' ? 'THREAD_UNCHECKED'
        : reason === 'authorityMismatch' ? 'AUTHORITY_MISMATCH'
          : 'LIFECYCLE_RECOVERY_BLOCKED'
    return {
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id !== operation.taskId) return task
        if (task.state === taskState
          && task.lifecycleOperationId === operation.id
          && task.updatedAt === operation.updatedAt) return task
        return { ...task, state: taskState, lifecycleOperationId: operation.id, updatedAt: now }
      }),
      managedWorktrees: state.managedWorktrees.map((worktree) => {
        if (worktree.id !== operation.worktreeId) return worktree
        if ((worktree.lifecycle === taskState || (taskState === 'needsAttention' && worktree.lifecycle === 'needsAttention'))
          && worktree.cleanupReason === message) return worktree
        return { ...worktree, lifecycle: taskState, cleanupReason: message, updatedAt: now }
      }),
      lifecycleOperations: state.lifecycleOperations.map((candidate) => {
        if (candidate.id !== operation.id) return candidate
        if (candidate.status === 'needsAttention'
          && candidate.phase === 'needsAttention'
          && candidate.lastError?.code === code
          && candidate.lastError.message === message) return candidate
        return {
          ...candidate,
          status: 'needsAttention' as const,
          phase: 'needsAttention' as const,
          updatedAt: now,
          lastError: { code, message, recordedAt: now },
        }
      }),
    }
  })
}

function taskForOperation(state: TaskStoreRead, operation: LifecycleOperation): Task | null {
  return state.tasks.find((task) => task.id === operation.taskId) ?? null
}

function worktreeForOperation(
  state: TaskStoreRead,
  operation: LifecycleOperation,
): ManagedWorktree | null {
  if (!operation.worktreeId) return null
  return state.managedWorktrees.find((worktree) => (
    worktree.id === operation.worktreeId && worktree.taskId === operation.taskId
  )) ?? null
}

async function recoverArchiveOperation(
  store: TaskStore,
  operation: LifecycleOperation,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<LifecycleRecoveryOutcome> {
  const initialState = store.read()
  const task = taskForOperation(initialState, operation)
  if (!task) throw new LifecycleRecoveryError('authorityMismatch', 'Archive operation task is missing')
  const worktree = worktreeForOperation(initialState, operation)
  if (operation.worktreeId && !worktree) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Archive operation worktree ownership is missing')
  }

  let prepared: Awaited<ReturnType<RecoveryWorktrees['prepareArchive']>> | null = null
  let cleanupError: unknown = null
  if (worktree) {
    try {
      requireWorktreeRecovery(dependencies)
      if (worktree.lifecycle === 'removed' && worktree.snapshot) {
        dependencies.snapshotStore.load(worktree.snapshot)
        prepared = {
          snapshot: worktree.snapshot,
          headSha: worktree.snapshot.headSha,
          privateRef: worktree.privateRef ?? `refs/cranberri/tasks/${operation.taskId}`,
          sourceGuard: worktree.snapshot.artifactDigestSha256,
        }
      } else {
        prepared = await dependencies.worktrees.prepareArchive({
          operationId: operation.id,
          worktreeId: worktree.id,
          snapshotStore: dependencies.snapshotStore,
        })
      }
    } catch (error) {
      cleanupError = error
    }
  }

  const currentOperation = store.read().lifecycleOperations.find((candidate) => candidate.id === operation.id) ?? operation
  const threadState = await reconcileThreadLifecycle(
    store,
    currentOperation,
    task.threadId,
    dependencies,
    now,
  )

  if (prepared && worktree && worktree.lifecycle !== 'removed') {
    try {
      requireWorktreeRecovery(dependencies)
      await dependencies.worktrees.removePreparedArchive({
        operationId: operation.id,
        worktreeId: worktree.id,
        repositoryPath: dependencies.repositoryPath(task.projectId),
        snapshotStore: dependencies.snapshotStore,
        snapshot: prepared.snapshot,
      })
    } catch (error) {
      cleanupError = error
    }
  }

  if (cleanupError) {
    const message = errorMessage(cleanupError, 'Managed worktree archive cleanup could not be completed')
    await updateIfChanged(store, (state) => ({
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
        ...candidate,
        state: 'cleanupBlocked' as const,
        lifecycleOperationId: operation.id,
        archivedAt: candidate.archivedAt ?? now,
        handoff: null,
        updatedAt: now,
      } : candidate),
      managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree?.id ? {
        ...candidate,
        lifecycle: 'cleanupBlocked' as const,
        cleanupReason: message,
        archivedAt: candidate.archivedAt ?? now,
        archiveHeadSha: prepared?.headSha ?? candidate.archiveHeadSha,
        headSha: prepared?.headSha ?? candidate.headSha,
        privateRef: prepared?.privateRef ?? candidate.privateRef,
        snapshot: prepared?.snapshot ?? candidate.snapshot ?? null,
        updatedAt: now,
      } : candidate),
      lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
        ...candidate,
        status: 'needsAttention' as const,
        phase: 'needsAttention' as const,
        updatedAt: now,
        lastError: { code: 'WORKTREE_CLEANUP_BLOCKED', message, recordedAt: now },
      } : candidate),
      localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === task.id
        ? { ...state.localLeaseByProjectId, [task.projectId]: null }
        : state.localLeaseByProjectId,
    }))
    await appendReceiptOnce(store, operation.id, {
      phase: 'needsAttention',
      subphase: 'taskCommitted',
      recordedAt: now,
      receiptId: `${operation.id}:taskCommitted:archive`,
      details: worktree ? { checkoutPath: worktree.path } : null,
    })
    return {
      taskId: task.id,
      operationId: operation.id,
      kind: 'archive',
      status: 'needsAttention',
      reason: 'executorBlocked',
      threadState,
      message,
    }
  }

  await store.update((state) => ({
    ...state,
    tasks: state.tasks.map((candidate) => candidate.id === task.id ? {
      ...candidate,
      state: 'archived' as const,
      lifecycleOperationId: operation.id,
      archivedAt: candidate.archivedAt ?? now,
      handoff: null,
      updatedAt: now,
    } : candidate),
    managedWorktrees: state.managedWorktrees.map((candidate) => candidate.id === worktree?.id ? {
      ...candidate,
      lifecycle: 'removed' as const,
      cleanupReason: null,
      archivedAt: candidate.archivedAt ?? now,
      archiveHeadSha: prepared?.headSha ?? candidate.archiveHeadSha,
      headSha: prepared?.headSha ?? candidate.headSha,
      privateRef: prepared?.privateRef ?? candidate.privateRef,
      snapshot: prepared?.snapshot ?? candidate.snapshot ?? null,
      updatedAt: now,
    } : candidate),
    lifecycleOperations: state.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
      ...candidate,
      status: 'completed' as const,
      phase: 'archived' as const,
      updatedAt: now,
      lastError: null,
    } : candidate),
    localLeaseByProjectId: state.localLeaseByProjectId[task.projectId] === task.id
      ? { ...state.localLeaseByProjectId, [task.projectId]: null }
      : state.localLeaseByProjectId,
  }))
  await appendReceiptOnce(store, operation.id, {
    phase: 'archived',
    subphase: 'taskCommitted',
    recordedAt: now,
    receiptId: `${operation.id}:taskCommitted:archive`,
    details: worktree ? { checkoutPath: worktree.path } : null,
  })

  if (worktree) {
    try {
      requireWorktreeRecovery(dependencies)
      await dependencies.worktrees.purgeArchiveQuarantine(operation.id, worktree.id)
    } catch (error) {
      const message = errorMessage(error, 'Archive quarantine cleanup could not be completed')
      await markOperationBlocked(store, operation.id, 'executorBlocked', message, now)
      return {
        taskId: task.id,
        operationId: operation.id,
        kind: 'archive',
        status: 'needsAttention',
        reason: 'executorBlocked',
        threadState,
        message,
      }
    }
  }
  return {
    taskId: task.id,
    operationId: operation.id,
    kind: 'archive',
    status: 'repaired',
    reason: 'operationCompleted',
    threadState,
    message: 'Interrupted archive lifecycle completed during startup.',
  }
}

async function recoverRestoreOperation(
  store: TaskStore,
  operation: LifecycleOperation,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<LifecycleRecoveryOutcome> {
  const state = store.read()
  const task = taskForOperation(state, operation)
  if (!task) throw new LifecycleRecoveryError('authorityMismatch', 'Restore operation task is missing')
  const worktree = worktreeForOperation(state, operation)
  if (operation.worktreeId && !worktree) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Restore operation worktree ownership is missing')
  }

  if (worktree) {
    requireWorktreeRecovery(dependencies)
    if (!worktree.snapshot || !worktree.privateRef || !operation.restoreReservation) {
      throw new LifecycleRecoveryError('authorityMismatch', 'Restore operation has incomplete durable snapshot authority')
    }
    const restored = await dependencies.worktrees.restorePreparedArchive({
      operationId: operation.id,
      worktreeId: worktree.id,
      repositoryPath: dependencies.repositoryPath(task.projectId),
      snapshotStore: dependencies.snapshotStore,
      snapshot: worktree.snapshot,
    })
    const restoredWorktree = worktreeForOperation(store.read(), operation)
    if (!restoredWorktree || restoredWorktree.path !== restored.checkoutPath) {
      throw new LifecycleRecoveryError('authorityMismatch', 'Restored worktree authority was not committed to its reserved path')
    }
    const current = store.read().lifecycleOperations.find((candidate) => candidate.id === operation.id) ?? operation
    const environmentRestored = current.receipts.some((receipt) => receipt.subphase === 'environmentRestored')
    if (worktree.environmentRevision && !environmentRestored) {
      if (!dependencies.restoreEnvironment) {
        throw new LifecycleRecoveryError('executorBlocked', 'Environment restore executor is unavailable during startup')
      }
      await dependencies.restoreEnvironment(task, restoredWorktree, worktree.environmentRevision)
      await appendReceiptOnce(store, operation.id, {
        phase: 'restoreEnvironment',
        subphase: 'environmentRestored',
        recordedAt: now,
        receiptId: `${operation.id}:environmentRestored:${worktree.environmentRevision}`,
        details: { checkoutPath: worktree.path },
      })
    }
  }

  const currentOperation = store.read().lifecycleOperations.find((candidate) => candidate.id === operation.id) ?? operation
  const threadState = await reconcileThreadLifecycle(
    store,
    currentOperation,
    task.threadId,
    dependencies,
    now,
  )
  await store.update((current) => ({
    ...current,
    tasks: current.tasks.map((candidate) => candidate.id === task.id ? {
      ...candidate,
      checkoutId: worktree?.checkoutId ?? candidate.checkoutId,
      location: worktree ? 'worktree' as const : 'local' as const,
      state: worktree ? 'active' as const : 'local' as const,
      archivedAt: null,
      handoff: null,
      lifecycleOperationId: operation.id,
      updatedAt: now,
    } : candidate),
    managedWorktrees: current.managedWorktrees.map((candidate) => candidate.id === worktree?.id ? {
      ...candidate,
      lifecycle: 'active' as const,
      cleanupReason: null,
      archivedAt: null,
      updatedAt: now,
    } : candidate),
    lifecycleOperations: current.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
      ...candidate,
      status: 'running' as const,
      phase: 'restored' as const,
      updatedAt: now,
      lastError: null,
    } : candidate),
  }))
  await appendReceiptOnce(store, operation.id, {
    phase: 'restored',
    subphase: 'taskCommitted',
    recordedAt: now,
    receiptId: `${operation.id}:taskCommitted:restore`,
    details: worktree ? { checkoutPath: worktree.path } : null,
  })
  if (worktree?.snapshot) {
    requireWorktreeRecovery(dependencies)
    await dependencies.worktrees.retireRestoredSnapshot({
      operationId: operation.id,
      worktreeId: worktree.id,
      repositoryPath: dependencies.repositoryPath(task.projectId),
      snapshotStore: dependencies.snapshotStore,
      snapshot: worktree.snapshot,
    })
    await store.update((current) => ({
      ...current,
      managedWorktrees: current.managedWorktrees.map((candidate) => candidate.id === worktree.id ? {
        ...candidate,
        snapshot: null,
        privateRef: null,
        archiveHeadSha: null,
        updatedAt: now,
      } : candidate),
      lifecycleOperations: current.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
        ...candidate,
        status: 'completed' as const,
        phase: 'restored' as const,
        updatedAt: now,
        lastError: null,
      } : candidate),
    }))
  } else {
    await store.updateLifecycleOperation(operation.id, (candidate) => ({
      ...candidate,
      status: 'completed',
      phase: 'restored',
      updatedAt: now,
      lastError: null,
    }))
  }
  return {
    taskId: task.id,
    operationId: operation.id,
    kind: 'restore',
    status: 'repaired',
    reason: 'operationCompleted',
    threadState,
    message: 'Interrupted restore lifecycle completed during startup.',
  }
}

async function recoverDeleteOperation(
  store: TaskStore,
  operation: LifecycleOperation,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<LifecycleRecoveryOutcome> {
  const state = store.read()
  const task = taskForOperation(state, operation)
  const worktree = worktreeForOperation(state, operation)
  if (!task && !worktree) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Delete operation has no remaining durable task or worktree authority')
  }
  if (operation.worktreeId && !worktree) {
    throw new LifecycleRecoveryError('authorityMismatch', 'Delete operation worktree ownership is missing')
  }
  const threadId = task?.threadId ?? operation.purgeSelectors?.threadId ?? null
  const threadState = await reconcileThreadLifecycle(store, operation, threadId, dependencies, now)

  if (worktree) {
    requireWorktreeRecovery(dependencies)
    if (!worktree.snapshot || !operation.purgeSelectors) {
      throw new LifecycleRecoveryError('authorityMismatch', 'Delete operation has incomplete durable purge authority')
    }
    await dependencies.worktrees.purgeOwnedArtifacts({
      operationId: operation.id,
      worktreeId: worktree.id,
      repositoryPath: dependencies.repositoryPath(worktree.projectId),
      snapshotStore: dependencies.snapshotStore,
      snapshot: worktree.snapshot,
    })
  }

  await store.update((current) => ({
    ...current,
    tasks: current.tasks.filter((candidate) => candidate.id !== operation.taskId),
    managedWorktrees: current.managedWorktrees.filter((candidate) => candidate.id !== operation.worktreeId),
    lifecycleOperations: current.lifecycleOperations.map((candidate) => candidate.id === operation.id ? {
      ...candidate,
      status: 'completed' as const,
      phase: 'completed' as const,
      updatedAt: now,
      lastError: null,
    } : candidate),
    localLeaseByProjectId: Object.fromEntries(Object.entries(current.localLeaseByProjectId).map(
      ([projectId, taskId]) => [projectId, taskId === operation.taskId ? null : taskId],
    )),
  }))
  return {
    taskId: operation.taskId,
    operationId: operation.id,
    kind: 'delete',
    status: 'repaired',
    reason: 'operationCompleted',
    threadState,
    message: 'Interrupted delete purge completed during startup.',
  }
}

async function recoverLifecycleOperation(
  store: TaskStore,
  operation: LifecycleOperation,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<LifecycleRecoveryOutcome> {
  if (operation.kind === 'archive') return recoverArchiveOperation(store, operation, dependencies, now)
  if (operation.kind === 'restore') return recoverRestoreOperation(store, operation, dependencies, now)
  return recoverDeleteOperation(store, operation, dependencies, now)
}

async function migrateLegacyArchives(
  store: TaskStore,
  dependencies: TaskRecoveryDependencies,
  now: number,
): Promise<LifecycleRecoveryOutcome[]> {
  const outcomes: LifecycleRecoveryOutcome[] = []
  const state = store.read()
  const activeTaskIds = new Set(state.lifecycleOperations
    .filter((operation) => operation.status !== 'completed')
    .map((operation) => operation.taskId))
  const candidates = state.managedWorktrees
    .filter((worktree) => (worktree.lifecycle === 'archived' || worktree.lifecycle === 'cleanupBlocked')
      && Boolean(worktree.taskId)
      && !activeTaskIds.has(worktree.taskId!))
    .sort((left, right) => left.updatedAt - right.updatedAt)

  for (const worktree of candidates) {
    const task = store.read().tasks.find((candidate) => candidate.id === worktree.taskId)
    if (!task || (task.state !== 'archived' && task.state !== 'cleanupBlocked')) continue
    const inspection = await (dependencies.inspectLegacyArchive ?? inspectLegacyArchive)(worktree)
    if (inspection !== 'clear') {
      const ignored = inspection === 'ignored'
      const reason = ignored ? 'ignoredContent' as const : 'unsafeLegacyArchive' as const
      const message = ignored
        ? 'Legacy archived worktree contains ignored content and was preserved without source changes.'
        : 'Legacy archived worktree ownership or Git state could not be proven safe for automatic migration.'
      await updateIfChanged(store, (current) => ({
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? candidate.state === 'cleanupBlocked'
            ? candidate
            : { ...candidate, state: 'cleanupBlocked' as const, updatedAt: now }
          : candidate),
        managedWorktrees: current.managedWorktrees.map((candidate) => candidate.id === worktree.id
          ? candidate.lifecycle === 'cleanupBlocked' && candidate.cleanupReason === message
            ? candidate
            : { ...candidate, lifecycle: 'cleanupBlocked' as const, cleanupReason: message, updatedAt: now }
          : candidate),
      }))
      outcomes.push({
        taskId: task.id,
        operationId: null,
        kind: 'legacyArchive',
        status: 'needsAttention',
        reason,
        threadState: null,
        message,
      })
      continue
    }

    const operation = await store.beginLifecycleOperation({
      kind: 'archive',
      taskId: task.id,
      worktreeId: worktree.id,
      startedAt: now,
    })
    outcomes.push(await recoverArchiveOperation(store, operation, dependencies, now))
  }
  return outcomes
}

export async function reconcileTaskStore(
  store: TaskStore,
  now = Date.now(),
  dependencies?: TaskRecoveryDependencies,
): Promise<TaskRecoveryResult> {
  const before = store.read()
  const handoffRecoveries = interruptedHandoffs(before.tasks)
  const candidate = recoveredState(before, now)
  if (JSON.stringify(candidate) !== JSON.stringify(before)) {
    await store.update((state) => recoveredState(state, now))
  }

  const lifecycleRecoveries: LifecycleRecoveryOutcome[] = []
  if (dependencies) {
    const operations = store.read().lifecycleOperations
      .filter((operation) => operation.status !== 'completed' || (
        operation.kind === 'archive'
        && Boolean(operation.worktreeId)
        && operation.phase === 'archived'
        && !operation.receipts.some((receipt) => receipt.subphase === 'quarantinePurged')
      ))
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    for (const operation of operations) {
      try {
        lifecycleRecoveries.push(await recoverLifecycleOperation(store, operation, dependencies, now))
      } catch (error) {
        const recoveryError = error instanceof LifecycleRecoveryError
          ? error
          : new LifecycleRecoveryError(
            'executorBlocked',
            errorMessage(error, `Interrupted ${operation.kind} lifecycle could not be completed`),
          )
        await markOperationBlocked(
          store,
          operation.id,
          recoveryError.reason,
          recoveryError.message,
          now,
        )
        lifecycleRecoveries.push({
          taskId: operation.taskId,
          operationId: operation.id,
          kind: operation.kind,
          status: 'needsAttention',
          reason: recoveryError.reason,
          threadState: recoveryError.threadState,
          message: recoveryError.message,
        })
      }
    }
    lifecycleRecoveries.push(...await migrateLegacyArchives(store, dependencies, now))
  }

  const committed = store.read()
  const changed = JSON.stringify(committed) !== JSON.stringify(before)
  return {
    changed,
    revision: committed.revision,
    repairedTaskIds: changedTaskIds(before, committed),
    handoffRecoveries,
    lifecycleRecoveries,
  }
}
