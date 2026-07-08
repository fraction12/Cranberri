import { describe, expect, it } from 'vitest'
import { shouldAutoLoadRepoSessions } from './repo-sessions-state'

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
})
