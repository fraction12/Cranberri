import type { LatestRepoFileContext } from '../state/actions'

export const REPO_FILE_CONTEXT_CAPTURED_EVENT = 'cranberri:repo-file-context-captured'

export function createRepoFileContextCapturedEvent(context: LatestRepoFileContext): CustomEvent<LatestRepoFileContext> {
  return new CustomEvent(REPO_FILE_CONTEXT_CAPTURED_EVENT, { detail: context })
}

export function repoFileContextFromEvent(event: Event): LatestRepoFileContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestRepoFileContext> | null | undefined
  if (!detail || typeof detail.repoPath !== 'string' || !detail.file || typeof detail.file.path !== 'string') {
    return null
  }
  return detail as LatestRepoFileContext
}
