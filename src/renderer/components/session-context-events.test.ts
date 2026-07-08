import { describe, expect, it } from 'vitest'
import type { LatestSessionContext } from '../state/session-search'
import { createSessionContextCapturedEvent, sessionContextFromEvent, SESSION_CONTEXT_CAPTURED_EVENT } from './session-context-events'

const context: LatestSessionContext = {
  result: {
    repoPath: '/repo/cranberri',
    archived: false,
    session: {
      id: 'thread-1',
      title: 'Session context',
      preview: 'Session preview',
      cwd: '/repo/cranberri',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      turnCount: 1,
    },
  },
  thread: {
    id: 'thread-1',
    title: 'Session context',
    preview: 'Session preview',
    cwd: '/repo/cranberri',
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    turnCount: 1,
    turns: [],
  },
}

describe('session context events', () => {
  it('round-trips captured session context', () => {
    const event = createSessionContextCapturedEvent(context)

    expect(event.type).toBe(SESSION_CONTEXT_CAPTURED_EVENT)
    expect(sessionContextFromEvent(event)).toEqual(context)
  })

  it('ignores non-session events', () => {
    expect(sessionContextFromEvent(new Event(SESSION_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(sessionContextFromEvent(new CustomEvent(SESSION_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
  })
})
