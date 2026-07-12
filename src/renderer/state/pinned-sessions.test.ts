import { describe, expect, it } from 'vitest'
import type { CranberriAppState } from '@/shared/appState'
import type { CodexSessionSummary } from '@/shared/codex'
import { pinnedSessionIds, pinnedSessionRecords, removePinnedSessions, togglePinnedSession } from './pinned-sessions'

function appState(overrides: Partial<CranberriAppState> = {}): CranberriAppState {
  return {
    version: 3,
    expandedProjectIds: {},
    workspacesByProjectId: {},
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
  it('reads richer pinned records by project identity', () => {
    const state = appState({
      pinnedCodexSessionsByProjectId: {
        project: [
          { id: 'thread-1', title: 'Thread one', archived: true },
          { id: 'thread-2' },
        ],
      },
    })

    expect(pinnedSessionRecords(state, 'project')).toEqual([
      { id: 'thread-1', title: 'Thread one', archived: true },
      { id: 'thread-2' },
    ])
    expect(pinnedSessionIds(state, 'project')).toEqual(['thread-1', 'thread-2'])
  })

  it('pins and unpins a session in the project-keyed record', () => {
    const pinned = togglePinnedSession(appState(), 'project', session({ archived: true }))

    expect(pinned.pinnedCodexSessionsByProjectId.project).toEqual([
      { id: 'thread-1', title: 'Important thread', archived: true, updatedAt: 2 },
    ])

    const unpinned = togglePinnedSession(pinned, 'project', session())

    expect(unpinned.pinnedCodexSessionsByProjectId.project).toBeUndefined()
  })

  it('removes pinned sessions from project state', () => {
    const state = appState({
      pinnedCodexSessionsByProjectId: {
        project: [
          { id: 'thread-1', title: 'Thread one' },
          { id: 'thread-2', title: 'Thread two' },
        ],
      },
    })

    const next = removePinnedSessions(state, 'project', ['thread-1'])

    expect(next.pinnedCodexSessionsByProjectId.project).toEqual([{ id: 'thread-2', title: 'Thread two' }])
  })
})
