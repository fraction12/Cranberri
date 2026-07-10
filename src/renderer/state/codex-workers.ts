import type { CodexSessionSummary, CodexThread, CodexWorker } from '@/shared/codex'
import { codexWorkerIsActive, mergeWorkerCollections, upsertCodexWorker, workerFromSessionSummary } from '@/shared/codex-workers'

export type CodexWorkerGraph = Record<string, CodexWorker[]>

function hydrateWorkerDescendants(
  graph: CodexWorkerGraph,
  worker: CodexWorker,
  ancestors = new Set<string>(),
): CodexWorker {
  if (ancestors.has(worker.threadId)) return worker
  const nextAncestors = new Set(ancestors).add(worker.threadId)
  const children = mergeWorkerCollections(worker.workers, graph[worker.threadId])
    .map((child) => hydrateWorkerDescendants(graph, child, nextAncestors))
  return children.length > 0 ? { ...worker, workers: children } : worker
}

function attachWorkerToNestedParent(
  workers: CodexWorker[],
  parentThreadId: string,
  incoming: CodexWorker,
  ancestors = new Set<string>(),
): CodexWorker[] {
  let changed = false
  const next = workers.map((worker) => {
    if (ancestors.has(worker.threadId)) return worker
    if (worker.threadId === parentThreadId) {
      changed = true
      return { ...worker, workers: upsertCodexWorker(worker.workers ?? [], incoming) }
    }
    if (!worker.workers?.length) return worker
    const children = attachWorkerToNestedParent(
      worker.workers,
      parentThreadId,
      incoming,
      new Set(ancestors).add(worker.threadId),
    )
    if (children === worker.workers) return worker
    changed = true
    return { ...worker, workers: children }
  })
  return changed ? next : workers
}

export function hydrateWorkersFromGraph(graph: CodexWorkerGraph, workers: CodexWorker[]): CodexWorker[] {
  return workers.map((worker) => hydrateWorkerDescendants(graph, worker))
}

export function hydrateSessionWorkerGraph(
  graph: CodexWorkerGraph,
  session: CodexSessionSummary,
  workers: CodexWorker[],
): CodexWorkerGraph {
  let next = graph
  const sessionWorker = workerFromSessionSummary(session)
  if (sessionWorker) next = upsertWorkerGraph(next, sessionWorker.parentThreadId, sessionWorker)
  for (const worker of workers) next = upsertWorkerGraph(next, session.id, worker)
  return next
}

export function upsertWorkerGraph(graph: CodexWorkerGraph, parentThreadId: string, worker: CodexWorker): CodexWorkerGraph {
  const incoming = hydrateWorkerDescendants(graph, worker)
  const next: CodexWorkerGraph = {
    ...graph,
    [parentThreadId]: upsertCodexWorker(graph[parentThreadId] ?? [], incoming),
  }
  for (const [ancestorThreadId, workers] of Object.entries(next)) {
    const nested = attachWorkerToNestedParent(workers, parentThreadId, incoming)
    if (nested !== workers) next[ancestorThreadId] = nested
  }
  return next
}

export function applyWorkerUpdate(
  threads: CodexThread[],
  parentThreadId: string,
  worker: CodexWorker,
): CodexThread[] {
  let changed = false
  const next = threads.map((thread) => {
    if (thread.id === parentThreadId) {
      changed = true
      return { ...thread, workers: upsertCodexWorker(thread.workers ?? [], worker) }
    }
    const existingWorkers = thread.workers ?? []
    const nestedWorkers = attachWorkerToNestedParent(existingWorkers, parentThreadId, worker)
    if (nestedWorkers !== existingWorkers) {
      changed = true
      return { ...thread, workers: nestedWorkers }
    }
    if (thread.id === worker.threadId) {
      changed = true
      const active = codexWorkerIsActive(worker.status)
      return {
        ...thread,
        title: worker.title ?? thread.title,
        sessionId: worker.sessionId ?? thread.sessionId,
        parentThreadId: worker.parentThreadId,
        agentNickname: worker.nickname ?? thread.agentNickname,
        agentRole: worker.role ?? thread.agentRole,
        isHistorical: active ? false : thread.isHistorical,
        isRunning: active,
        currentActivity: active ? (worker.message ?? 'Working') : undefined,
      }
    }
    return thread
  })
  return changed ? next : threads
}
