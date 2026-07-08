export const NEW_THREAD_EMPTY_STATE = 'Ask Codex to inspect, edit, or explain this repo.'

export function shouldRestoreDraftAfterSendError(threadId: string | undefined, error: unknown): boolean {
  const threadCreated = Boolean(error && typeof error === 'object' && 'threadCreated' in error)
  return !threadId && !threadCreated
}
