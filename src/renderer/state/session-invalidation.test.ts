import { describe, expect, it, vi } from 'vitest'
import { invalidateSessions, sessionInvalidationMatches, subscribeSessionInvalidation } from './session-invalidation'

describe('session invalidation', () => {
  it('scopes updates by project and repository path', () => {
    expect(sessionInvalidationMatches({ projectId: 'one' }, 'one', '/one')).toBe(true)
    expect(sessionInvalidationMatches({ projectId: 'two' }, 'one', '/one')).toBe(false)
    expect(sessionInvalidationMatches({ repoPath: '/two' }, 'one', '/one')).toBe(false)
    expect(sessionInvalidationMatches({}, 'one', '/one')).toBe(true)
  })

  it('publishes once to active subscribers and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionInvalidation(listener)
    invalidateSessions({ projectId: 'one', threadId: 'thread-1' })
    unsubscribe()
    invalidateSessions({ projectId: 'two' })
    expect(listener).toHaveBeenCalledOnce()
  })
})
