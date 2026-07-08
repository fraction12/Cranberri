import type { AgentProcessInfo } from '@/shared/processes'

export const PROCESS_CONTEXT_CAPTURED_EVENT = 'cranberri:process-context-captured'

export function createProcessContextCapturedEvent(processInfo: AgentProcessInfo): CustomEvent<AgentProcessInfo> {
  return new CustomEvent(PROCESS_CONTEXT_CAPTURED_EVENT, { detail: processInfo })
}

export function processContextFromEvent(event: Event): AgentProcessInfo | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<AgentProcessInfo> | null | undefined
  if (!detail || typeof detail.id !== 'string' || typeof detail.repoPath !== 'string') return null
  return detail as AgentProcessInfo
}
