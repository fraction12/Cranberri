import type { LatestSessionContext } from '../state/session-search'

export const SESSION_CONTEXT_CAPTURED_EVENT = 'cranberri:session-context-captured'

export function createSessionContextCapturedEvent(context: LatestSessionContext): CustomEvent<LatestSessionContext> {
  return new CustomEvent(SESSION_CONTEXT_CAPTURED_EVENT, { detail: context })
}

export function sessionContextFromEvent(event: Event): LatestSessionContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestSessionContext> | null | undefined
  if (!detail?.result?.session?.id || !detail.thread?.id) return null
  return detail as LatestSessionContext
}
