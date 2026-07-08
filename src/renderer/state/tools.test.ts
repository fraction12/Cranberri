import { describe, expect, it } from 'vitest'
import type { TelemetryEventRecord } from '@/shared/telemetry'
import { toolEventsFromTelemetry } from './tools'

describe('toolEventsFromTelemetry', () => {
  it('keeps only valid persisted tool events', () => {
    const events: TelemetryEventRecord[] = [
      {
        id: 1,
        timestamp: '2026-07-07T00:00:00.000Z',
        source: 'main',
        type: 'codex:event',
        payload: {},
      },
      {
        id: 2,
        timestamp: '2026-07-07T00:00:01.000Z',
        source: 'tool',
        type: 'running',
        payload: {
          eventId: 'event-1',
          threadId: 'thread-1',
          toolCallId: 'tool-1',
          name: 'github.search',
          kind: 'mcp',
          status: 'running',
          timestamp: '2026-07-07T00:00:01.000Z',
        },
      },
      {
        id: 3,
        timestamp: '2026-07-07T00:00:02.000Z',
        source: 'tool',
        type: 'bad',
        payload: { nope: true },
      },
    ]

    expect(toolEventsFromTelemetry(events)).toEqual([
      expect.objectContaining({
        telemetryId: 2,
        telemetryType: 'running',
        persistedAt: '2026-07-07T00:00:01.000Z',
        eventId: 'event-1',
        name: 'github.search',
      }),
    ])
  })
})
