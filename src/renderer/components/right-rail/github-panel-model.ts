import type { GitHubPanelData } from '@/shared/git'

export interface GitHubPanelBadge {
  id: string
  label: string
  title: string
}

export function githubPanelErrorMessage(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (/Could not resolve to a Repository|repository not found/i.test(message)) {
    return 'Repository not found on GitHub.'
  }
  if (/network|fetch failed|ENOTFOUND|ECONN(?:REFUSED|RESET)|timed? out/i.test(message)) {
    return 'GitHub is unavailable. Check your connection and retry.'
  }
  return message || fallback
}

export function githubPanelBadges(data?: GitHubPanelData | null): GitHubPanelBadge[] {
  if (!data) return []

  const badges: GitHubPanelBadge[] = []
  if (data.source) {
    const sourceLabels = {
      octokit: 'Octokit API',
      gh: 'gh CLI',
      git: 'local git',
    }
    const sourceTitles = {
      octokit: 'Loaded through the structured GitHub API client',
      gh: 'Loaded through the local gh CLI fallback',
      git: 'Loaded from the local git repository without network access',
    }
    badges.push({
      id: 'source',
      label: sourceLabels[data.source],
      title: sourceTitles[data.source],
    })
  }
  badges.push(data.authenticated
    ? {
        id: 'auth',
        label: 'authenticated',
        title: 'GitHub data was loaded with an available token',
      }
    : {
        id: 'auth',
        label: 'fallback',
        title: 'GitHub data was loaded without an app-level token',
      })
  return badges
}
