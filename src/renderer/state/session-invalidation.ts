export interface SessionInvalidation {
  projectId?: string
  repoPath?: string
  threadId?: string
}

type SessionInvalidationListener = (invalidation: SessionInvalidation) => void
const listeners = new Set<SessionInvalidationListener>()

export function invalidateSessions(invalidation: SessionInvalidation): void {
  for (const listener of listeners) listener(invalidation)
}

export function subscribeSessionInvalidation(listener: SessionInvalidationListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function sessionInvalidationMatches(
  invalidation: SessionInvalidation,
  projectId: string,
  repoPath: string,
): boolean {
  if (invalidation.projectId && invalidation.projectId !== projectId) return false
  if (invalidation.repoPath && invalidation.repoPath !== repoPath) return false
  return true
}
