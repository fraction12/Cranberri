import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  parseToolCatalogId,
  toolCatalogSnapshotSchema,
  toolRegistrySnapshotSchema,
  type ToolCatalogActivitySummary,
  type ToolCatalogId,
  type ToolCatalogSnapshot,
  type ToolCatalogTaskKey,
  type ToolCatalogTaskProvenance,
  type ToolCatalogTaskStatus,
  type ToolEventRecord,
} from '../../shared/tools'

const MAX_ACTIVITY_PER_THREAD = 20
const EMPTY_ACTIVITY: ToolEventRecord[] = []
const activityByThread = new Map<string, ToolEventRecord[]>()
const activityEpochByThread = new Map<string, string>()
const activityListenersByThread = new Map<string, Set<() => void>>()

export interface ToolTimelineEvent extends ToolEventRecord {
  telemetryId?: number
  telemetryType?: string
  persistedAt?: string
}

function emitActivityChange(threadId?: string): void {
  const threadIds = threadId
    ? [threadId]
    : [...activityListenersByThread.keys()]
  for (const id of threadIds) {
    for (const listener of activityListenersByThread.get(id) ?? []) listener()
  }
}

function subscribeActivity(threadId: string, listener: () => void): () => void {
  const listeners = activityListenersByThread.get(threadId) ?? new Set<() => void>()
  listeners.add(listener)
  activityListenersByThread.set(threadId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) activityListenersByThread.delete(threadId)
  }
}

export function recordToolActivityEvent(event: ToolEventRecord): void {
  if (!event.catalogId) return
  const current = activityByThread.get(event.threadId) ?? []
  const withoutDuplicate = current.filter((item) => item.eventId !== event.eventId)
  activityByThread.set(event.threadId, [...withoutDuplicate, event].slice(-MAX_ACTIVITY_PER_THREAD))
  emitActivityChange(event.threadId)
}

export function clearToolActivityEvents(threadId?: string): void {
  if (threadId) {
    activityByThread.delete(threadId)
    activityEpochByThread.delete(threadId)
    emitActivityChange(threadId)
  } else {
    activityByThread.clear()
    activityEpochByThread.clear()
    emitActivityChange()
  }
}

export function toolActivityForThread(threadId: string | null | undefined): ToolEventRecord[] {
  return threadId ? activityByThread.get(threadId) ?? EMPTY_ACTIVITY : EMPTY_ACTIVITY
}

function alignActivityEpoch(snapshot: ToolCatalogSnapshot | undefined): void {
  const taskKey = snapshot?.taskKey
  if (!taskKey) return
  const previousEpoch = activityEpochByThread.get(taskKey.threadId)
  if (previousEpoch && previousEpoch !== taskKey.capabilityEpoch) {
    activityByThread.delete(taskKey.threadId)
    emitActivityChange(taskKey.threadId)
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

function activityOverlay(event: ToolEventRecord, taskKey: ToolCatalogTaskKey) {
  const state = activityOutcome(event)
  return {
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

  const existingIds = new Set(snapshot.entries.map((entry) => entry.id))
  const entries = snapshot.entries.map((entry) => {
    const event = latestByCatalogId.get(entry.id)
    if (!event) return entry
    return {
      ...entry,
      ...activityOverlay(event, taskKey),
    }
  })

  for (const [catalogId, event] of latestByCatalogId) {
    if (existingIds.has(catalogId)) continue
    const parsed = parseToolCatalogId(catalogId)
    if (!parsed) continue
    entries.push({
      id: catalogId,
      name: parsed.name,
      source: parsed.source,
      description: 'Directly observed in the active Codex task.',
      isDefault: false,
      probeCapability: { kind: 'unsupported', reason: 'Readiness comes from direct task activity.' },
      isPinned: false,
      isDismissedDefault: false,
      inRail: false,
      isOrphan: false,
      machine: {
        status: parsed.source.kind === 'mcp'
          ? 'connected'
          : parsed.source.kind === 'codex' || parsed.source.kind === 'browser'
            ? 'available'
            : 'unknown',
        version: null,
        observedAt: event.timestamp,
        stale: false,
        provenance: 'active-task-inventory',
        diagnosticCode: event.errorCode ?? null,
      },
      ...activityOverlay(event, taskKey),
    })
  }

  return {
    ...snapshot,
    entries,
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
  const subscribe = useCallback((listener: () => void) => (
    enabled && threadId ? subscribeActivity(threadId, listener) : () => undefined
  ), [enabled, threadId])
  const getSnapshot = useCallback(() => (
    enabled ? toolActivityForThread(threadId) : EMPTY_ACTIVITY
  ), [enabled, threadId])
  const activity = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ACTIVITY)
  const data = useMemo(
    () => activity.slice(-limit),
    [activity, limit],
  )
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
