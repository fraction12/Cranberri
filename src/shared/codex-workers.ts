import type {
  CodexSdkThreadItem,
  CodexSessionSummary,
  CodexSessionThread,
  CodexWorker,
  CodexWorkerStatus,
} from './codex'

const WORKER_STATUSES = new Set<CodexWorkerStatus>([
  'pendingInit',
  'running',
  'idle',
  'interrupted',
  'completed',
  'errored',
  'shutdown',
  'notFound',
])

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>
}

function milliseconds(value: number | null | undefined): number {
  if (!value) return Date.now()
  return value > 10_000_000_000 ? value : value * 1000
}

export function normalizeCodexWorkerStatus(value: unknown, fallback: CodexWorkerStatus = 'pendingInit'): CodexWorkerStatus {
  if (typeof value === 'string' && WORKER_STATUSES.has(value as CodexWorkerStatus)) {
    return value as CodexWorkerStatus
  }
  if (!value || typeof value !== 'object') return fallback
  const type = (value as { type?: unknown }).type
  if (type === 'active') return 'running'
  if (type === 'systemError') return 'errored'
  if (type === 'idle' || type === 'notLoaded') return 'idle'
  return fallback
}

export function codexWorkerIsActive(status: CodexWorkerStatus): boolean {
  return status === 'pendingInit' || status === 'running'
}

export function countActiveCodexWorkers(workers: ReadonlyArray<CodexWorker> | undefined): number {
  return workers?.filter((worker) => codexWorkerIsActive(worker.status)).length ?? 0
}

export function mergeCodexWorker(current: CodexWorker | undefined, incoming: CodexWorker): CodexWorker {
  if (!current) return incoming
  const useIncomingLifecycle = incoming.updatedAt >= current.updatedAt
  const merged = {
    ...current,
    ...definedFields(incoming),
    status: useIncomingLifecycle ? incoming.status : current.status,
    message: useIncomingLifecycle ? (incoming.message ?? current.message) : current.message,
    updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
  }
  if (!incoming.prompt && current.prompt) merged.prompt = current.prompt
  return merged
}

export function upsertCodexWorker(workers: CodexWorker[], incoming: CodexWorker): CodexWorker[] {
  const index = workers.findIndex((worker) => worker.threadId === incoming.threadId)
  if (index === -1) return [...workers, incoming]
  const next = [...workers]
  next[index] = mergeCodexWorker(next[index], incoming)
  return next
}

function collabStatus(item: CodexSdkThreadItem, workerThreadId: string): { status: CodexWorkerStatus; message?: string } | null {
  const directState = item.agentStatus
  const state = item.agentsStates?.[workerThreadId]
    ?? (typeof directState === 'string' ? { status: directState } : directState ?? undefined)
  if (state?.status) {
    return {
      status: normalizeCodexWorkerStatus(state.status),
      message: state.message ?? undefined,
    }
  }
  const callFailed = item.status === 'failed'
  const tool = item.tool?.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase())
  if (callFailed) return tool === 'spawnAgent'
    ? { status: 'errored', message: 'Worker failed to start' }
    : null
  switch (tool) {
    case 'spawnAgent':
      return { status: item.status === 'inProgress' ? 'pendingInit' : 'running' }
    case 'sendInput':
    case 'resumeAgent':
      return { status: 'running' }
    case 'closeAgent':
      return { status: item.status === 'completed' ? 'shutdown' : 'running' }
    case 'wait':
      return item.status === 'inProgress' ? { status: 'running' } : null
    default:
      return { status: 'running' }
  }
}

export function workersFromThreadItem(
  parentThreadId: string,
  item: CodexSdkThreadItem | undefined,
  observedAt = Date.now(),
): CodexWorker[] {
  if (!item?.type) return []
  if (item.type === 'subAgentActivity' && item.agentThreadId) {
    return [{
      threadId: item.agentThreadId,
      parentThreadId,
      status: item.kind === 'interrupted' ? 'interrupted' : 'running',
      agentPath: item.agentPath,
      updatedAt: observedAt,
    }]
  }
  if (item.type !== 'collabAgentToolCall' && item.type !== 'collabToolCall') return []

  const ownerThreadId = item.senderThreadId || parentThreadId
  const targets = [...new Set([
    ...(item.receiverThreadIds ?? []),
    ...(item.receiverThreadId ? [item.receiverThreadId] : []),
    ...(item.newThreadId ? [item.newThreadId] : []),
    ...Object.keys(item.agentsStates ?? {}),
  ])]
  return targets.flatMap((workerThreadId) => {
    const lifecycle = collabStatus(item, workerThreadId)
    if (!lifecycle) return []
    return [{
      threadId: workerThreadId,
      parentThreadId: ownerThreadId,
      prompt: item.tool === 'spawnAgent' || item.tool === 'spawn_agent' ? item.prompt ?? undefined : undefined,
      lastInstruction: item.prompt ?? undefined,
      model: item.model ?? undefined,
      reasoningEffort: item.reasoningEffort ?? undefined,
      status: lifecycle.status,
      message: lifecycle.message,
      updatedAt: observedAt,
    }]
  })
}

export function workersFromSessionThread(thread: Pick<CodexSessionThread, 'id' | 'turns' | 'updatedAt'>): CodexWorker[] {
  let workers: CodexWorker[] = []
  let sequence = 0
  for (const turn of thread.turns) {
    const observedAt = milliseconds(turn.completedAt ?? turn.startedAt ?? thread.updatedAt)
    for (const item of turn.items ?? []) {
      sequence += 1
      for (const worker of workersFromThreadItem(thread.id, item, observedAt + sequence)) {
        workers = upsertCodexWorker(workers, worker)
      }
    }
  }
  return workers
}

export function workerFromSessionSummary(session: CodexSessionSummary): CodexWorker | null {
  if (!session.parentThreadId) return null
  return {
    threadId: session.id,
    parentThreadId: session.parentThreadId,
    sessionId: session.sessionId,
    title: session.title,
    nickname: session.agentNickname ?? undefined,
    role: session.agentRole ?? undefined,
    status: normalizeCodexWorkerStatus(session.status, 'idle'),
    cwd: session.cwd,
    ephemeral: session.ephemeral,
    source: session.source,
    createdAt: milliseconds(session.createdAt),
    updatedAt: milliseconds(session.recencyAt ?? session.updatedAt ?? session.createdAt),
    workers: session.workers,
  }
}

export function mergeWorkerCollections(...collections: Array<ReadonlyArray<CodexWorker> | undefined>): CodexWorker[] {
  let workers: CodexWorker[] = []
  for (const collection of collections) {
    for (const worker of collection ?? []) workers = upsertCodexWorker(workers, worker)
  }
  return workers
}
