export type LatestAppContextKind = 'active-chat' | 'diagnostics' | 'usage' | 'workspace-brief'

export interface LatestAppContext {
  kind: LatestAppContextKind
  label: string
  text: string
}

export const APP_CONTEXT_CAPTURED_EVENT = 'cranberri:app-context-captured'

export function createAppContextCapturedEvent(context: LatestAppContext): CustomEvent<LatestAppContext> {
  return new CustomEvent(APP_CONTEXT_CAPTURED_EVENT, { detail: context })
}

export function appContextFromEvent(event: Event): LatestAppContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestAppContext> | null | undefined
  if (!detail || typeof detail.kind !== 'string' || typeof detail.label !== 'string' || typeof detail.text !== 'string') {
    return null
  }
  return detail as LatestAppContext
}
