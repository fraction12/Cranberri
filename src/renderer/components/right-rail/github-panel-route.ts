import type { GitHubPanelData, GitHubPanelKind, GitHubRepoSummary } from '@/shared/git'

interface GitHubPanelClient {
  git: Pick<Window['cranberri']['git'], 'githubSummary' | 'taskGithubSummary'>
  github: Pick<Window['cranberri']['github'], 'panelData' | 'taskPanelData'>
}

export interface GitHubPanelRoute {
  repoPath: string
  taskId: string | null
}

export function loadGitHubSummary(
  client: GitHubPanelClient,
  route: GitHubPanelRoute,
): Promise<GitHubRepoSummary> {
  return route.taskId
    ? client.git.taskGithubSummary(route.taskId)
    : client.git.githubSummary(route.repoPath)
}

export function loadGitHubPanelData(
  client: GitHubPanelClient,
  route: GitHubPanelRoute,
  kind: GitHubPanelKind,
): Promise<GitHubPanelData> {
  return route.taskId
    ? client.github.taskPanelData(route.taskId, kind)
    : client.github.panelData(route.repoPath, kind)
}
