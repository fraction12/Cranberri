import type { LatestCodexResourceContext } from './codex-resources'

export const CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT = 'cranberri:codex-resource-context-captured'

export function createCodexResourceContextCapturedEvent(context: LatestCodexResourceContext): CustomEvent<LatestCodexResourceContext> {
  return new CustomEvent(CODEX_RESOURCE_CONTEXT_CAPTURED_EVENT, { detail: context })
}

export function codexResourceContextFromEvent(event: Event): LatestCodexResourceContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestCodexResourceContext> | null | undefined
  if (!detail || typeof detail.kind !== 'string' || typeof detail.label !== 'string' || typeof detail.text !== 'string') {
    return null
  }
  return detail as LatestCodexResourceContext
}
