import type { CodexEvent } from '../../shared/codex'

const HIGH_VOLUME_EVENT_TYPES = new Set<CodexEvent['type']>([
  'agent_message_delta',
  'item_started',
  'log',
])

export function shouldForwardCodexEventToRenderer(event: CodexEvent): boolean {
  return event.type !== 'log'
}

export function shouldPersistCodexEventTelemetry(event: CodexEvent): boolean {
  return !HIGH_VOLUME_EVENT_TYPES.has(event.type)
}
