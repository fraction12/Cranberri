import { describe, expect, it } from 'vitest'
import type { GitHubPanelData, GitHubRepoSummary } from '@/shared/git'
import { githubItemChatContext, githubPanelChatContext } from './github-chat-context'

const SUMMARY: GitHubRepoSummary = {
  remoteUrl: 'git@github.com:fraction12/Cranberri.git',
  webUrl: 'https://github.com/fraction12/Cranberri',
  owner: 'fraction12',
  repo: 'Cranberri',
  branch: 'main',
  tracking: 'origin/main',
  ahead: 2,
  behind: 1,
  isGitHub: true,
}

const PANEL: GitHubPanelData = {
  kind: 'pulls',
  source: 'octokit',
  authenticated: true,
  fetchedAt: Date.parse('2026-07-08T01:00:00Z'),
  items: [{
    id: 'pr-7',
    title: '#7 Improve GitHub panel',
    subtitle: 'Adds structured context sharing',
    state: 'open',
    url: 'https://github.com/fraction12/Cranberri/pull/7',
    author: 'dushyantgarg',
    createdAt: '2026-07-08T00:00:00Z',
    meta: { checks: 'green', changedFiles: 4 },
  }],
}

describe('GitHub chat context', () => {
  it('formats repo and panel data as bounded chat context', () => {
    const context = githubPanelChatContext({
      repoPath: '/repo/Cranberri',
      summary: SUMMARY,
      data: PANEL,
    })

    expect(context).toContain('GitHub context:')
    expect(context).toContain('GitHub repo: fraction12/Cranberri')
    expect(context).toContain('Ahead/behind: 2/1')
    expect(context).toContain('Panel: pulls')
    expect(context).toContain('Source: octokit authenticated')
    expect(context).toContain('#7 Improve GitHub panel')
  })

  it('formats a single GitHub item with metadata', () => {
    const context = githubItemChatContext({
      repoPath: '/repo/Cranberri',
      summary: SUMMARY,
      kind: 'pulls',
      item: PANEL.items[0],
    })

    expect(context).toContain('GitHub item context:')
    expect(context).toContain('Kind: pulls')
    expect(context).toContain('Title: #7 Improve GitHub panel')
    expect(context).toContain('Author: dushyantgarg')
    expect(context).toContain('- checks: green')
    expect(context).toContain('- changedFiles: 4')
  })

  it('keeps newest GitHub context when too large', () => {
    const context = githubItemChatContext({
      repoPath: '/repo/Cranberri',
      summary: SUMMARY,
      kind: 'issues',
      item: {
        id: 'huge',
        title: 'Huge issue',
        subtitle: `${'x'.repeat(14_000)}latest-detail`,
      },
    })

    expect(context).toContain('latest-detail')
    expect(context).toContain('GitHub context')
    expect(context.length).toBeLessThan(12_500)
  })
})
