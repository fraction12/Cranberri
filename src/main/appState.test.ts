import { describe, expect, it } from 'vitest'
import { parseAppState } from './appState'

describe('parseAppState', () => {
  it('accepts old chat and terminal workspace state', () => {
    const parsed = parseAppState({
      version: 1,
      expandedRepoIds: {},
      workspacesByRepoId: {
        repo: {
          activeWindowId: 'chat-1',
          windows: [
            { id: 'chat-1', type: 'chat', title: 'Chat' },
            { id: 'term-1', type: 'terminal', title: 'Terminal' },
          ],
        },
      },
    })

    expect(parsed.workspacesByRepoId.repo.windows).toHaveLength(2)
    expect(parsed.pinnedCodexSessionIdsByRepoPath).toEqual({})
    expect(parsed.pinnedCodexSessionsByRepoPath).toEqual({})
  })

  it('accepts browser windows with metadata', () => {
    expect(parseAppState({
      version: 1,
      expandedRepoIds: {},
      workspacesByRepoId: {
        repo: {
          activeWindowId: 'browser-1',
          windows: [{
            id: 'browser-1',
            type: 'browser',
            title: 'Browser',
            browser: {
              url: 'https://example.com',
              title: 'Example',
              profileId: 'repo-main',
              viewportMode: 'responsive',
            },
          }],
        },
      },
    }).workspacesByRepoId.repo.windows[0]).toMatchObject({
      type: 'browser',
      browser: {
        url: 'https://example.com',
        profileId: 'repo-main',
      },
    })
  })

  it('accepts pinned Codex session ids per repo path', () => {
    const parsed = parseAppState({
      version: 1,
      expandedRepoIds: {},
      workspacesByRepoId: {},
      pinnedCodexSessionIdsByRepoPath: {
        '/repo/cranberri': ['thread-1', 'thread-2'],
      },
    })

    expect(parsed.pinnedCodexSessionIdsByRepoPath['/repo/cranberri']).toEqual(['thread-1', 'thread-2'])
    expect(parsed.pinnedCodexSessionsByRepoPath['/repo/cranberri']).toEqual([
      { id: 'thread-1' },
      { id: 'thread-2' },
    ])
  })

  it('accepts pinned Codex session records per repo path', () => {
    expect(parseAppState({
      version: 1,
      expandedRepoIds: {},
      workspacesByRepoId: {},
      pinnedCodexSessionsByRepoPath: {
        '/repo/cranberri': [
          { id: 'thread-1', title: 'Important thread', archived: true, updatedAt: 123 },
        ],
      },
    }).pinnedCodexSessionsByRepoPath['/repo/cranberri']).toEqual([
      { id: 'thread-1', title: 'Important thread', archived: true, updatedAt: 123 },
    ])
  })
})
