import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  toolCatalogSnapshotSchema,
  toolRegistrySnapshotSchema,
  type ToolCatalogActivitySummary,
  type ToolCatalogId,
  type ToolCatalogSnapshot,
  type ToolCatalogTaskProvenance,
  type ToolCatalogTaskStatus,
  type ToolEventRecord,
} from '../../shared/tools'

const MAX_ACTIVITY_PER_THREAD = 20
const activityByThread = new Map<string, ToolEventRecord[]>()
const activityEpochByThread = new Map<string, string>()
const activityListeners = new Set<() => void>()
let activityVersion = 0

export interface ToolTimelineEvent extends ToolEventRecord {
  telemetryId?: number
  telemetryType?: string
  persistedAt?: string
}

function emitActivityChange(): void {
  activityVersion += 1
  for (const listener of activityListeners) listener()
}

function subscribeActivity(listener: () => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}

export function recordToolActivityEvent(event: ToolEventRecord): void {
  if (!event.catalogId) return
  const current = activityByThread.get(event.threadId) ?? []
  const withoutDuplicate = current.filter((item) => item.eventId !== event.eventId)
  activityByThread.set(event.threadId, [...withoutDuplicate, event].slice(-MAX_ACTIVITY_PER_THREAD))
  emitActivityChange()
}

export function clearToolActivityEvents(threadId?: string): void {
  if (threadId) {
    activityByThread.delete(threadId)
    activityEpochByThread.delete(threadId)
  } else {
    activityByThread.clear()
    activityEpochByThread.clear()
  }
  emitActivityChange()
}

export function toolActivityForThread(threadId: string | null | undefined): ToolEventRecord[] {
  return threadId ? activityByThread.get(threadId) ?? [] : []
}

function alignActivityEpoch(snapshot: ToolCatalogSnapshot | undefined): void {
  const taskKey = snapshot?.taskKey
  if (!taskKey) return
  const previousEpoch = activityEpochByThread.get(taskKey.threadId)
  if (previousEpoch && previousEpoch !== taskKey.capabilityEpoch) {
    activityByThread.delete(taskKey.threadId)
    emitActivityChange()
  }
  activityEpochByThread.set(taskKey.threadId, taskKey.capabilityEpoch)
}

function activityOutcome(event: ToolEventRecord): {
  outcome: ToolCatalogActivitySummary['outcome']
  taskStatus: ToolCatalogTaskStatus
  provenance: ToolCatalogTaskProvenance
} {
  switch (event.status) {
    case 'completed':
      return { outcome: 'succeeded', taskStatus: 'usable', provenance: 'same-task-success' }
    case 'failed':
    case 'disabled':
      return { outcome: 'failed', taskStatus: 'unavailable', provenance: 'same-task-failure' }
    case 'denied':
      return { outcome: 'denied', taskStatus: 'denied', provenance: 'same-task-denied' }
    case 'approval_requested':
      return { outcome: 'approval-required', taskStatus: 'approval-required', provenance: 'same-task-approval' }
    default:
      return { outcome: 'started', taskStatus: 'addressable', provenance: 'same-task-started' }
  }
}

export function overlayToolCatalogActivity(
  snapshot: ToolCatalogSnapshot,
  events: ToolEventRecord[],
): ToolCatalogSnapshot {
  const taskKey = snapshot.taskKey
  if (!taskKey) return snapshot

  const latestByCatalogId = new Map<string, ToolEventRecord>()
  for (const event of events) {
    if (event.threadId !== taskKey.threadId || !event.catalogId) continue
    const current = latestByCatalogId.get(event.catalogId)
    if (!current || event.timestamp >= current.timestamp) latestByCatalogId.set(event.catalogId, event)
  }
  if (latestByCatalogId.size === 0) return snapshot

  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => {
      const event = latestByCatalogId.get(entry.id)
      if (!event) return entry
      const state = activityOutcome(event)
      return {
        ...entry,
        task: {
          status: state.taskStatus,
          taskKey,
          observedAt: event.timestamp,
          provenance: state.provenance,
        },
        activity: {
          outcome: state.outcome,
          observedAt: event.timestamp,
          callId: event.toolCallId ?? null,
          durationMs: event.durationMs ?? null,
        },
      }
    }),
  }
}

export function toolCatalogQueryOptions(activeThreadId: string | null, enabled: boolean) {
  return {
    queryKey: ['tools', 'catalog', activeThreadId] as const,
    queryFn: async () => toolCatalogSnapshotSchema.parse(
      await window.cranberri.tools.catalog.list(activeThreadId),
    ),
    enabled,
    staleTime: Infinity,
    refetchInterval: false as const,
    refetchOnWindowFocus: false as const,
  }
}

export function useRecentToolEvents(
  threadId: string | null = null,
  limit = MAX_ACTIVITY_PER_THREAD,
  enabled = true,
) {
  useSyncExternalStore(
    subscribeActivity,
    () => activityVersion,
    () => 0,
  )
  const data = enabled ? toolActivityForThread(threadId).slice(-limit) : []
  return { data, isLoading: false }
}

export function useToolCatalog(activeThreadId: string | null, enabled = true) {
  const options = toolCatalogQueryOptions(activeThreadId, enabled)
  const query = useQuery(options)
  const queryClient = useQueryClient()
  const { data: activity } = useRecentToolEvents(activeThreadId, MAX_ACTIVITY_PER_THREAD, enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [testingToolId, setTestingToolId] = useState<ToolCatalogId | null>(null)

  useEffect(() => alignActivityEpoch(query.data), [query.data])

  const setCatalog = useCallback((snapshot: ToolCatalogSnapshot) => {
    queryClient.setQueryData(options.queryKey, toolCatalogSnapshotSchema.parse(snapshot))
  }, [options.queryKey, queryClient])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const snapshot = await window.cranberri.tools.catalog.refresh(activeThreadId)
      setCatalog(snapshot)
      return snapshot
    } finally {
      setRefreshing(false)
    }
  }, [activeThreadId, setCatalog])

  const testTool = useCallback(async (catalogId: ToolCatalogId) => {
    setTestingToolId(catalogId)
    try {
      const snapshot = await window.cranberri.tools.catalog.test(catalogId, activeThreadId)
      setCatalog(snapshot)
      return snapshot
    } finally {
      setTestingToolId(null)
    }
  }, [activeThreadId, setCatalog])

  return {
    ...query,
    data: useMemo(
      () => query.data ? overlayToolCatalogActivity(query.data, activity) : undefined,
      [activity, query.data],
    ),
    refresh,
    refreshing,
    testTool,
    testingToolId,
  }
}

export function useToolRegistry(threadId?: string | null) {
  return useQuery({
    queryKey: ['tools', 'registry', threadId ?? null],
    queryFn: async () => toolRegistrySnapshotSchema.parse(await window.cranberri.tools.registry(threadId ?? null)),
    staleTime: 15_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
}
