import type { LifecycleOperation, Task } from '../shared/tasks'
import type { TaskStore } from './task-store'

export type TaskLifecycleTelemetryEmitter = (
  type: string,
  payload: Record<string, unknown>,
) => void | Promise<void>

export interface TaskLifecycleTelemetryObserver {
  flush(): Promise<void>
  dispose(): void
}

interface Snapshot {
  operations: Map<string, LifecycleOperation>
  tasks: Map<string, Task>
}

function readSnapshot(store: TaskStore): Snapshot {
  const state = store.read()
  return {
    operations: new Map(state.lifecycleOperations.map((operation) => [operation.id, operation])),
    tasks: new Map(state.tasks.map((task) => [task.id, task])),
  }
}

function basePayload(operation: LifecycleOperation, task: Task | undefined): Record<string, unknown> {
  return {
    operationId: operation.id,
    kind: operation.kind,
    taskId: operation.taskId,
    projectId: task?.projectId ?? null,
    worktreeId: operation.worktreeId,
    threadId: task?.threadId ?? null,
    location: task?.location ?? null,
    status: operation.status,
    phase: operation.phase,
    retryAttempt: operation.retry.attempt,
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
  }
}

function receiptIdentity(operationId: string, index: number, receipt: LifecycleOperation['receipts'][number]): string {
  return receipt.receiptId ?? `${operationId}:${index}:${receipt.phase}:${receipt.subphase}:${receipt.recordedAt}`
}

function boundedMessage(message: string): string {
  return message
    .replace(/(^|[\s("'=])\/(?:[^\s,;:'")]+\/)*[^\s,;:'")]+/g, '$1[path]')
    .slice(0, 600)
}

export function observeTaskLifecycleTelemetry(
  store: TaskStore,
  emit: TaskLifecycleTelemetryEmitter,
): TaskLifecycleTelemetryObserver {
  let disposed = false
  let snapshot = readSnapshot(store)
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (type: string, payload: Record<string, unknown>): void => {
    queue = queue.then(async () => {
      try {
        await emit(type, payload)
      } catch (error) {
        console.warn('[task-lifecycle-telemetry] emit failed', error)
      }
    })
  }

  for (const operation of snapshot.operations.values()) {
    if (operation.status === 'completed') continue
    enqueue('task:lifecycle:recovery-observed', basePayload(operation, snapshot.tasks.get(operation.taskId)))
  }

  const unsubscribe = store.subscribe(() => {
    if (disposed) return
    const next = readSnapshot(store)

    for (const operation of next.operations.values()) {
      const previous = snapshot.operations.get(operation.id)
      const task = next.tasks.get(operation.taskId) ?? snapshot.tasks.get(operation.taskId)
      const base = basePayload(operation, task)
      if (!previous) enqueue('task:lifecycle:started', base)

      const previousReceiptIds = new Set((previous?.receipts ?? []).map((receipt, index) => (
        receiptIdentity(operation.id, index, receipt)
      )))
      operation.receipts.forEach((receipt, index) => {
        if (previousReceiptIds.has(receiptIdentity(operation.id, index, receipt))) return
        enqueue('task:lifecycle:receipt', {
          ...base,
          phase: receipt.phase,
          subphase: receipt.subphase,
          recordedAt: receipt.recordedAt,
        })
      })

      if (operation.status === 'needsAttention' && previous?.status !== 'needsAttention') {
        enqueue('task:lifecycle:needs-attention', {
          ...base,
          errorCode: operation.lastError?.code ?? null,
          errorMessage: operation.lastError ? boundedMessage(operation.lastError.message) : null,
        })
      }
      if (operation.status === 'completed' && previous?.status !== 'completed') {
        enqueue('task:lifecycle:completed', {
          ...base,
          durationMs: Math.max(0, operation.updatedAt - operation.startedAt),
        })
      }
    }
    snapshot = next
  })

  return {
    flush: () => queue,
    dispose: () => {
      disposed = true
      unsubscribe()
    },
  }
}
