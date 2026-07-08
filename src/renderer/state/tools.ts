import { useQuery } from '@tanstack/react-query'
import type { TelemetryEventRecord } from '@/shared/telemetry'
import { parseToolEvent, toolRegistrySnapshotSchema, type ToolEventRecord } from '../../shared/tools'

export interface ToolTimelineEvent extends ToolEventRecord {
  telemetryId: number
  telemetryType: string
  persistedAt: string
}

export function toolEventsFromTelemetry(events: TelemetryEventRecord[]): ToolTimelineEvent[] {
  return events.flatMap((event) => {
    if (event.source !== 'tool') return []
    const toolEvent = parseToolEvent(event.payload)
    if (!toolEvent) return []
    return [{
      ...toolEvent,
      telemetryId: event.id,
      telemetryType: event.type,
      persistedAt: event.timestamp,
    }]
  })
}

export function useRecentToolEvents(limit = 120, enabled = true) {
  return useQuery({
    queryKey: ['tools', 'events', limit],
    queryFn: async () => {
      const { events } = await window.cranberri.telemetry.readEvents(limit)
      return toolEventsFromTelemetry(events)
    },
    enabled,
    refetchInterval: 1500,
  })
}

export function useToolRegistry(threadId?: string | null) {
  return useQuery({
    queryKey: ['tools', 'registry', threadId ?? null],
    queryFn: async () => toolRegistrySnapshotSchema.parse(await window.cranberri.tools.registry(threadId ?? null)),
    refetchInterval: 15000,
    staleTime: 5000,
  })
}
