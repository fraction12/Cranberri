import { describe, expect, it } from 'vitest'
import { githubPanelBadges, githubPanelErrorMessage } from './github-panel-model'
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
  it('turns missing-repository IPC failures into concise product copy', () => {
    expect(githubPanelErrorMessage(
      new Error("Error invoking remote method 'github:task:panel-data': Error: GraphQL: Could not resolve to a Repository with the name 'example/missing'. (repository)"),
      'Failed to load GitHub data.',
    )).toBe('Repository not found on GitHub.')
  })

  it('turns network failures into a recoverable message and strips transport noise', () => {
    expect(githubPanelErrorMessage(new Error('Error invoking remote method \'github:task:panel-data\': Error: fetch failed'), 'Fallback'))
      .toBe('GitHub is unavailable. Check your connection and retry.')
    expect(githubPanelErrorMessage(new Error("Error invoking remote method 'github:task:panel-data': Error: Access denied"), 'Fallback'))
      .toBe('Access denied')
  })

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
