export function shouldAutoLoadRepoSessions({
  isActiveRepo,
  loaded,
  loading,
  loadError,
}: {
  isActiveRepo: boolean
  loaded: boolean
  loading: boolean
  loadError: string | null
}): boolean {
  return isActiveRepo && !loaded && !loading && !loadError
}
