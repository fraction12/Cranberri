import { describe, expect, it } from 'vitest'
import { githubPanelBadges } from './github-panel-model'
import type { GitHubPanelData } from '@/shared/git'

function panel(overrides: Partial<GitHubPanelData> = {}): GitHubPanelData {
  return {
    kind: 'repo',
    items: [],
    fetchedAt: Date.parse('2026-07-08T10:00:00.000Z'),
    source: 'octokit',
    authenticated: true,
    ...overrides,
  }
}

describe('GitHub panel model', () => {
  it('does not build badges before panel data loads', () => {
    expect(githubPanelBadges()).toEqual([])
  })

  it('labels authenticated Octokit data', () => {
    expect(githubPanelBadges(panel()).map((badge) => badge.label)).toEqual(['Octokit API', 'authenticated'])
  })

  it('labels gh fallback data', () => {
    expect(githubPanelBadges(panel({ source: 'gh', authenticated: false })).map((badge) => badge.label)).toEqual(['gh CLI', 'fallback'])
  })

  it('labels local git fallback data', () => {
    expect(githubPanelBadges(panel({ source: 'git', authenticated: false })).map((badge) => badge.label)).toEqual(['local git', 'fallback'])
  })
})
