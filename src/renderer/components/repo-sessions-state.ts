import type { CodexSessionSummary } from '@/shared/codex'

export function shouldAutoLoadRepoSessions({
  loaded,
  loading,
  loadError,
}: {
  loaded: boolean
  loading: boolean
  loadError: string | null
}): boolean {
  return !loaded && !loading && !loadError
}

export function mergeHydratedPinnedSessions(
  recent: CodexSessionSummary[],
  archived: CodexSessionSummary[],
  hydrated: CodexSessionSummary[],
): { recent: CodexSessionSummary[]; archived: CodexSessionSummary[] } {
  return {
    recent: [...recent, ...hydrated.filter((session) => !session.archived)],
    archived: [...archived, ...hydrated.filter((session) => session.archived)],
  }
}
