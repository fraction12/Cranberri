import { beforeEach, describe, expect, it } from 'vitest'
import type { ToolCatalogSnapshot, ToolEventRecord } from '@/shared/tools'
import {
  clearToolActivityEvents,
  overlayToolCatalogActivity,
  recordToolActivityEvent,
  toolActivityForThread,
  toolCatalogQueryOptions,
} from './tools'

const TASK_KEY = { threadId: 'thread-1', capabilityEpoch: 'epoch-1' }

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

describe('task-scoped tool activity', () => {
  it('keeps a bounded task-local ring without telemetry polling', () => {
    for (let index = 0; index < 25; index += 1) {
      recordToolActivityEvent(event({
        eventId: `thread-1-${index}`,
        toolCallId: `call-${index}`,
        timestamp: `2026-07-09T20:00:${String(index).padStart(2, '0')}.000Z`,
      }))
    }
    recordToolActivityEvent(event({ eventId: 'thread-2', threadId: 'thread-2' }))

    expect(toolActivityForThread('thread-1')).toHaveLength(20)
    expect(toolActivityForThread('thread-1')[0]?.eventId).toBe('thread-1-5')
    expect(toolActivityForThread('thread-2').map((item) => item.eventId)).toEqual(['thread-2'])
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

  it('maps failed and approval events without retaining payload previews', () => {
    const failed = event({
      status: 'failed',
      errorCode: 'exit-1',
      argumentsPreview: 'must not survive',
      resultPreview: 'must not survive',
    })
    const result = overlayToolCatalogActivity(snapshot(), [failed])

    expect(result.entries[0]).toMatchObject({
      task: { status: 'unavailable', provenance: 'same-task-failure' },
      activity: { outcome: 'failed' },
    })
    expect(JSON.stringify(result.entries[0]?.activity)).not.toContain('must not survive')
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
    expect(options.staleTime).toBe(Infinity)
  })
})
