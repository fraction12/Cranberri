import { describe, expect, it } from 'vitest'
import type { CodexSessionSummary } from '@/shared/codex'
import { mergeHydratedPinnedSessions, shouldAutoLoadRepoSessions } from './repo-sessions-state'

function session(id: string, archived: boolean): CodexSessionSummary {
  return {
    id,
    title: id,
    preview: '',
    createdAt: 1,
    updatedAt: 1,
    archived,
    turnCount: 0,
  }
}

describe('repo session auto-load state', () => {
  it('auto-loads a rendered repo sessions panel when sessions have not been requested yet', () => {
    expect(shouldAutoLoadRepoSessions({
      loaded: false,
      loading: false,
      loadError: null,
    })).toBe(true)
  })

  it('does not auto-load busy, loaded, or failed repo session states', () => {
    expect(shouldAutoLoadRepoSessions({ loaded: true, loading: false, loadError: null })).toBe(false)
    expect(shouldAutoLoadRepoSessions({ loaded: false, loading: true, loadError: null })).toBe(false)
    expect(shouldAutoLoadRepoSessions({ loaded: false, loading: false, loadError: 'Nope' })).toBe(false)
  })

  it('keeps hydrated pinned sessions in their actual archive page', () => {
    const merged = mergeHydratedPinnedSessions(
      [session('recent-page', false)],
      [session('archived-page', true)],
      [session('hydrated-recent', false), session('hydrated-archived', true)],
    )

    expect(merged.recent.map((item) => item.id)).toEqual(['recent-page', 'hydrated-recent'])
    expect(merged.archived.map((item) => item.id)).toEqual(['archived-page', 'hydrated-archived'])
  })
})
