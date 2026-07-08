import { describe, expect, it } from 'vitest'
import type { CodexEvent } from '../../shared/codex'
import { shouldForwardCodexEventToRenderer, shouldPersistCodexEventTelemetry } from './eventPolicy'

describe('Codex event policy', () => {
  it('does not forward raw app-server log events to the renderer', () => {
    const event: CodexEvent = { type: 'log', level: 'stderr', text: 'dropping overload response' }

    expect(shouldForwardCodexEventToRenderer(event)).toBe(false)
  })

  it('does not persist high-volume stream events as telemetry', () => {
    const delta: CodexEvent = {
      type: 'agent_message_delta',
      threadId: 'thread-1',
      itemId: 'item-1',
      delta: 'token',
    }
    const itemStarted: CodexEvent = {
      type: 'item_started',
      threadId: 'thread-1',
      itemId: 'item-2',
      itemType: 'reasoning',
    }

    expect(shouldPersistCodexEventTelemetry(delta)).toBe(false)
    expect(shouldPersistCodexEventTelemetry(itemStarted)).toBe(false)
  })

  it('keeps low-volume lifecycle events visible to renderer and telemetry', () => {
    const event: CodexEvent = { type: 'run_end', threadId: 'thread-1' }

    expect(shouldForwardCodexEventToRenderer(event)).toBe(true)
    expect(shouldPersistCodexEventTelemetry(event)).toBe(true)
  })
})
