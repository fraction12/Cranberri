import type { CodexEvent } from '../../shared/codex'

const HIGH_VOLUME_EVENT_TYPES = new Set<CodexEvent['type']>([
  'agent_message_delta',
  'item_started',
  'log',
])

const TOOL_EVENT_TYPES = new Set<CodexEvent['type']>([
  'tool_call',
  'tool_event',
  'approval_request',
  'approval_completed',
  'worker_updated',
])

export function shouldForwardCodexEventToRenderer(event: CodexEvent): boolean {
  return event.type !== 'log'
}

export function shouldPersistCodexEventTelemetry(event: CodexEvent): boolean {
  return !HIGH_VOLUME_EVENT_TYPES.has(event.type) && !TOOL_EVENT_TYPES.has(event.type)
}
