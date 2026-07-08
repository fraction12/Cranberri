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
