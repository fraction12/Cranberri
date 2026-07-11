import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_ACTIVITY_RETENTION_MS, TOOL_CATALOG_FRESHNESS_MS, type ToolCatalogSnapshot, type ToolEventRecord } from '@/shared/tools'
import {
  clearToolActivityEvents,
  overlayToolCatalogActivity,
  recordToolActivityEvent,
  refreshToolCatalogQueries,
  toolActivityForThread,
  toolCatalogQueryOptions,
} from './tools'

const TASK_KEY = { threadId: 'thread-1', capabilityEpoch: 'epoch-1' }
const NOW = Date.parse('2026-07-09T20:30:00.000Z')

function event(overrides: Partial<ToolEventRecord> = {}): ToolEventRecord {
  return {
    eventId: 'event-1',
    threadId: 'thread-1',
    toolCallId: 'call-1',
    catalogId: 'codex:apply_patch',
    name: 'apply_patch',
    kind: 'file_change',
    status: 'completed',
    timestamp: '2026-07-09T20:00:00.000Z',
    durationMs: 25,
    ...overrides,
  }
}

function snapshot(): ToolCatalogSnapshot {
  return {
    generatedAt: '2026-07-09T19:59:00.000Z',
    taskKey: TASK_KEY,
    entries: [{
      id: 'codex:apply_patch',
      name: 'apply_patch',
      source: { kind: 'codex' },
      description: 'Applies a patch.',
      isDefault: true,
      probeCapability: { kind: 'unsupported', reason: 'Runtime metadata only.' },
      isPinned: false,
      isDismissedDefault: false,
      inRail: true,
      isOrphan: false,
      machine: {
        status: 'unknown',
        version: null,
        observedAt: null,
        stale: false,
        provenance: 'none',
        diagnosticCode: null,
      },
      task: {
        status: 'unknown',
        taskKey: TASK_KEY,
        observedAt: null,
        provenance: 'none',
      },
      activity: null,
    }],
    railToolIds: ['codex:apply_patch'],
    preservedPinnedToolIds: [],
    orphanPinnedToolIds: [],
    refresh: {
      status: 'fresh',
      observedAt: '2026-07-09T19:59:00.000Z',
      errorCode: null,
    },
  }
}

beforeEach(() => clearToolActivityEvents())
afterEach(() => vi.unstubAllGlobals())

describe('task-scoped tool activity', () => {
  it('keeps a bounded task-local ring without telemetry polling', () => {
    for (let index = 0; index < 25; index += 1) {
      recordToolActivityEvent(event({
        eventId: `thread-1-${index}`,
        toolCallId: `call-${index}`,
        timestamp: `2026-07-09T20:00:${String(index).padStart(2, '0')}.000Z`,
      }), NOW)
    }
    recordToolActivityEvent(event({ eventId: 'thread-2', threadId: 'thread-2' }), NOW)

    expect(toolActivityForThread('thread-1', NOW)).toHaveLength(20)
    expect(toolActivityForThread('thread-1', NOW)[0]?.eventId).toBe('thread-1-5')
    expect(toolActivityForThread('thread-2', NOW).map((item) => item.eventId)).toEqual(['thread-2'])
  })

  it('overlays only same-thread canonical activity and promotes successful use', () => {
    const completed = event()
    const otherThread = event({ eventId: 'other', threadId: 'thread-2', status: 'failed' })
    const result = overlayToolCatalogActivity(snapshot(), [otherThread, completed])

    expect(result.entries[0]).toMatchObject({
      task: {
        status: 'usable',
        provenance: 'same-task-success',
      },
      activity: {
        outcome: 'succeeded',
        callId: 'call-1',
        durationMs: 25,
      },
    })
  })

  it('stores only metadata and maps failed activity', () => {
    const failed = event({
      status: 'failed',
      errorCode: 'exit-1',
      argumentsPreview: 'must not survive',
      resultPreview: 'must not survive',
    })
    recordToolActivityEvent(failed, NOW)
    const cached = toolActivityForThread('thread-1', NOW)
    const result = overlayToolCatalogActivity(snapshot(), cached)

    expect(result.entries[0]).toMatchObject({
      task: { status: 'unavailable', provenance: 'same-task-failure' },
      activity: { outcome: 'failed' },
    })
    expect(JSON.stringify(cached)).not.toContain('must not survive')
    expect(cached[0]).not.toHaveProperty('argumentsPreview')
    expect(cached[0]).not.toHaveProperty('resultPreview')
    expect(cached[0]).not.toHaveProperty('error')
  })

  it('expires activity after thirty minutes', () => {
    recordToolActivityEvent(event({ timestamp: new Date(NOW).toISOString() }), NOW)

    expect(toolActivityForThread('thread-1', NOW + TOOL_ACTIVITY_RETENTION_MS - 1)).toHaveLength(1)
    expect(toolActivityForThread('thread-1', NOW + TOOL_ACTIVITY_RETENTION_MS + 1)).toEqual([])
  })

  it('does not let a delayed start replace a terminal event for the same call', () => {
    const completed = event({ timestamp: '2026-07-09T20:00:00.000Z', status: 'completed' })
    const delayedStart = event({
      eventId: 'event-start',
      timestamp: '2026-07-09T20:01:00.000Z',
      status: 'running',
    })

    const result = overlayToolCatalogActivity(snapshot(), [completed, delayedStart])

    expect(result.entries[0]).toMatchObject({
      task: { status: 'usable' },
      activity: { outcome: 'succeeded' },
    })
  })

  it('allows execution to continue after approval for the same call', () => {
    const approved = event({ timestamp: '2026-07-09T20:00:00.000Z', status: 'approved' })
    const running = event({
      eventId: 'event-running',
      timestamp: '2026-07-09T20:01:00.000Z',
      status: 'running',
    })

    const result = overlayToolCatalogActivity(snapshot(), [approved, running])

    expect(result.entries[0]).toMatchObject({
      task: { status: 'addressable' },
      activity: { outcome: 'started' },
    })
  })

  it('adds a directly observed literal tool to full discovery without pinning it', () => {
    const observed = event({
      eventId: 'custom-tool',
      toolCallId: 'custom-call',
      catalogId: 'codex:view_image',
      name: 'view_image',
    })
    const result = overlayToolCatalogActivity(snapshot(), [observed])

    expect(result.entries).toContainEqual(expect.objectContaining({
      id: 'codex:view_image',
      name: 'view_image',
      source: { kind: 'codex' },
      isDefault: false,
      inRail: false,
      task: expect.objectContaining({ status: 'usable' }),
    }))
    expect(result.railToolIds).not.toContain('codex:view_image')
  })
})

describe('catalog query lifecycle', () => {
  it('uses explicit lifecycle refresh with no interval polling', () => {
    const options = toolCatalogQueryOptions('thread-1', true)

    expect(options.queryKey).toEqual(['tools', 'catalog', 'thread-1'])
    expect(options.refetchInterval).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.staleTime).toBe(TOOL_CATALOG_FRESHNESS_MS)
    expect(options.refetchOnMount).toBe(true)
  })

  it('force-refreshes global and active-task catalogs after extension changes', async () => {
    const refresh = vi.fn(async (threadId: string | null) => ({
      ...snapshot(),
      taskKey: threadId ? TASK_KEY : null,
    }))
    vi.stubGlobal('window', { cranberri: { tools: { catalog: { refresh } } } })
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      setQueryData: vi.fn(),
    } as unknown as Parameters<typeof refreshToolCatalogQueries>[0]

    await refreshToolCatalogQueries(queryClient, 'thread-1')

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tools', 'catalog'],
      refetchType: 'none',
    })
    expect(refresh.mock.calls).toEqual([[null], ['thread-1']])
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['tools', 'catalog', null],
      expect.objectContaining({ taskKey: null }),
    )
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['tools', 'catalog', 'thread-1'],
      expect.objectContaining({ taskKey: TASK_KEY }),
    )
  })
})
