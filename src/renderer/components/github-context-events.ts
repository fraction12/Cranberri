import type { LatestGitHubContext } from './github-chat-context'

export const GITHUB_CONTEXT_CAPTURED_EVENT = 'cranberri:github-context-captured'

export function createGitHubContextCapturedEvent(context: LatestGitHubContext): CustomEvent<LatestGitHubContext> {
  return new CustomEvent(GITHUB_CONTEXT_CAPTURED_EVENT, { detail: context })
}

export function githubContextFromEvent(event: Event): LatestGitHubContext | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as Partial<LatestGitHubContext> | null | undefined
  if (!detail || typeof detail.kind !== 'string' || typeof detail.label !== 'string' || typeof detail.text !== 'string' || typeof detail.repoPath !== 'string') {
    return null
  }
  return detail as LatestGitHubContext
}
