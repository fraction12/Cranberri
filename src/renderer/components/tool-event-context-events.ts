import type { ToolEventRecord } from '@/shared/tools'

export const TOOL_EVENT_CONTEXT_CAPTURED_EVENT = 'cranberri:tool-event-context-captured'

export function createToolEventContextCapturedEvent(event: ToolEventRecord): CustomEvent<ToolEventRecord> {
  return new CustomEvent(TOOL_EVENT_CONTEXT_CAPTURED_EVENT, { detail: event })
}

export function toolEventContextFromEvent(event: Event): ToolEventRecord | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<ToolEventRecord> | null | undefined
  if (!detail || typeof detail.eventId !== 'string' || typeof detail.threadId !== 'string' || typeof detail.name !== 'string') {
    return null
  }
  return detail as ToolEventRecord
}
