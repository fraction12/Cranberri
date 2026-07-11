import { describe, expect, it } from 'vitest'
import type { CranberriAppState } from '@/shared/appState'
import type { CodexSessionSummary } from '@/shared/codex'
import { pinnedSessionIds, pinnedSessionRecords, removePinnedSessions, togglePinnedSession } from './pinned-sessions'

function appState(overrides: Partial<CranberriAppState> = {}): CranberriAppState {
  return {
    version: 2,
    expandedRepoIds: {},
    workspacesByRepoId: {},
    expandedProjectIds: {},
    workspacesByProjectId: {},
    pinnedCodexSessionIdsByRepoPath: {},
    pinnedCodexSessionsByRepoPath: {},
    pinnedCodexSessionsByProjectId: {},
    ...overrides,
  }
}

function session(overrides: Partial<CodexSessionSummary> = {}): CodexSessionSummary {
  return {
    id: 'thread-1',
    title: 'Important thread',
    preview: 'Useful prior work',
    cwd: '/repo/cranberri',
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    turnCount: 3,
    ...overrides,
  }
}

describe('pinned session state helpers', () => {
  it('merges legacy id pins with richer pinned records', () => {
    const state = appState({
      pinnedCodexSessionIdsByRepoPath: { '/repo/cranberri': ['thread-1', 'thread-2'] },
      pinnedCodexSessionsByRepoPath: { '/repo/cranberri': [{ id: 'thread-1', title: 'Thread one', archived: true }] },
    })

    expect(pinnedSessionRecords(state, '/repo/cranberri')).toEqual([
      { id: 'thread-1', title: 'Thread one', archived: true },
      { id: 'thread-2' },
    ])
    expect(pinnedSessionIds(state, '/repo/cranberri')).toEqual(['thread-1', 'thread-2'])
  })

  it('pins and unpins a session while keeping legacy ids in sync', () => {
    const pinned = togglePinnedSession(appState(), '/repo/cranberri', session({ archived: true }))

    expect(pinned.pinnedCodexSessionIdsByRepoPath['/repo/cranberri']).toEqual(['thread-1'])
    expect(pinned.pinnedCodexSessionsByRepoPath['/repo/cranberri']).toEqual([
      { id: 'thread-1', title: 'Important thread', archived: true, updatedAt: 2 },
    ])

    const unpinned = togglePinnedSession(pinned, '/repo/cranberri', session())

    expect(unpinned.pinnedCodexSessionIdsByRepoPath['/repo/cranberri']).toBeUndefined()
    expect(unpinned.pinnedCodexSessionsByRepoPath['/repo/cranberri']).toBeUndefined()
  })

  it('removes pinned sessions from both persisted shapes', () => {
    const state = appState({
      pinnedCodexSessionIdsByRepoPath: { '/repo/cranberri': ['thread-1', 'thread-2'] },
      pinnedCodexSessionsByRepoPath: {
        '/repo/cranberri': [
          { id: 'thread-1', title: 'Thread one' },
          { id: 'thread-2', title: 'Thread two' },
        ],
      },
    })

    const next = removePinnedSessions(state, '/repo/cranberri', ['thread-1'])

    expect(next.pinnedCodexSessionIdsByRepoPath['/repo/cranberri']).toEqual(['thread-2'])
    expect(next.pinnedCodexSessionsByRepoPath['/repo/cranberri']).toEqual([{ id: 'thread-2', title: 'Thread two' }])
  })
})
