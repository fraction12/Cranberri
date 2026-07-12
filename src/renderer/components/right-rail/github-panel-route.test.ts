import { describe, expect, it, vi } from 'vitest'
import { loadGitHubPanelData, loadGitHubSummary } from './github-panel-route'

function client() {
  return {
    git: {
      githubSummary: vi.fn().mockResolvedValue({}),
      taskGithubSummary: vi.fn().mockResolvedValue({}),
    },
    github: {
      panelData: vi.fn().mockResolvedValue({}),
      taskPanelData: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('GitHub panel execution routing', () => {
  it('uses task-aware APIs for a managed session', async () => {
    const api = client()
    const route = { repoPath: '/managed/worktree', taskId: 'task-1' }

    await loadGitHubSummary(api, route)
    await loadGitHubPanelData(api, route, 'branches')

    expect(api.git.taskGithubSummary).toHaveBeenCalledWith('task-1')
    expect(api.github.taskPanelData).toHaveBeenCalledWith('task-1', 'branches')
    expect(api.git.githubSummary).not.toHaveBeenCalled()
    expect(api.github.panelData).not.toHaveBeenCalled()
  })

  it('keeps registered-repo APIs for unbound sessions', async () => {
    const api = client()
    const route = { repoPath: '/registered/repo', taskId: null }

    await loadGitHubSummary(api, route)
    await loadGitHubPanelData(api, route, 'repo')

    expect(api.git.githubSummary).toHaveBeenCalledWith('/registered/repo')
    expect(api.github.panelData).toHaveBeenCalledWith('/registered/repo', 'repo')
    expect(api.git.taskGithubSummary).not.toHaveBeenCalled()
    expect(api.github.taskPanelData).not.toHaveBeenCalled()
  })
})
