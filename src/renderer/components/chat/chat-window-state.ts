export const NEW_THREAD_EMPTY_STATE = 'Ask Codex to inspect, edit, or explain this repo.'
const SESSION_WINDOW_PREFIX = 'session-'

export function sessionThreadIdFromWindowId(windowId: string): string | null {
  if (!windowId.startsWith(SESSION_WINDOW_PREFIX)) return null
  return windowId.slice(SESSION_WINDOW_PREFIX.length) || null
}

export function shouldSendComposerOnEnter(key: string, shiftKey: boolean, isRunning: boolean): boolean {
  return key === 'Enter' && !shiftKey && !isRunning
}

export function shouldRestoreDraftAfterSendError(threadId: string | undefined, error: unknown): boolean {
  const threadCreated = Boolean(error && typeof error === 'object' && 'threadCreated' in error)
  return !threadId && !threadCreated
}

export function shouldToastAfterSendError(threadId: string | undefined, draft: string, error: unknown): boolean {
  return draft.trim() === '/compact' || shouldRestoreDraftAfterSendError(threadId, error)
}
