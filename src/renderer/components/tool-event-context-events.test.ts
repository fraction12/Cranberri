import { describe, expect, it } from 'vitest'
import { createToolEventContextCapturedEvent, TOOL_EVENT_CONTEXT_CAPTURED_EVENT, toolEventContextFromEvent } from './tool-event-context-events'
import type { ToolEventRecord } from '@/shared/tools'

const TOOL_EVENT: ToolEventRecord = {
  eventId: 'event-1',
  threadId: 'thread-1',
  name: 'shell.exec',
  title: 'Run tests',
  kind: 'command',
  status: 'completed',
  timestamp: '2026-07-08T00:00:00.000Z',
  resultPreview: '184 tests passed',
}

describe('tool event context events', () => {
  it('round-trips captured tool event context', () => {
    const event = createToolEventContextCapturedEvent(TOOL_EVENT)

    expect(event.type).toBe(TOOL_EVENT_CONTEXT_CAPTURED_EVENT)
    expect(toolEventContextFromEvent(event)).toEqual(TOOL_EVENT)
  })

  it('ignores non-tool events', () => {
    expect(toolEventContextFromEvent(new Event('other'))).toBeNull()
    expect(toolEventContextFromEvent(new CustomEvent(TOOL_EVENT_CONTEXT_CAPTURED_EVENT, { detail: { eventId: 'event-1' } }))).toBeNull()
  })
})
