import { describe, expect, it } from 'vitest'
import { shouldAutoLoadRepoSessions } from './repo-sessions-state'

describe('repo session auto-load state', () => {
  it('auto-loads the active repo when sessions have not been requested yet', () => {
    expect(shouldAutoLoadRepoSessions({
      isActiveRepo: true,
      loaded: false,
      loading: false,
      loadError: null,
    })).toBe(true)
  })

  it('does not auto-load inactive, busy, loaded, or failed repo session states', () => {
    expect(shouldAutoLoadRepoSessions({ isActiveRepo: false, loaded: false, loading: false, loadError: null })).toBe(false)
    expect(shouldAutoLoadRepoSessions({ isActiveRepo: true, loaded: true, loading: false, loadError: null })).toBe(false)
    expect(shouldAutoLoadRepoSessions({ isActiveRepo: true, loaded: false, loading: true, loadError: null })).toBe(false)
    expect(shouldAutoLoadRepoSessions({ isActiveRepo: true, loaded: false, loading: false, loadError: 'Nope' })).toBe(false)
  })
})
