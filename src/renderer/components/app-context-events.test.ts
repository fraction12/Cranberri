import { describe, expect, it } from 'vitest'
import { appContextFromEvent, APP_CONTEXT_CAPTURED_EVENT, createAppContextCapturedEvent, type LatestAppContext } from './app-context-events'

const context: LatestAppContext = {
  kind: 'workspace-brief',
  label: 'Cranberri',
  text: 'Workspace brief:\nGitHub: fraction12/Cranberri',
}

describe('app context events', () => {
  it('round-trips captured app context', () => {
    const event = createAppContextCapturedEvent(context)

    expect(event.type).toBe(APP_CONTEXT_CAPTURED_EVENT)
    expect(appContextFromEvent(event)).toEqual(context)
  })

  it('ignores non-app context events', () => {
    expect(appContextFromEvent(new Event(APP_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(appContextFromEvent(new CustomEvent(APP_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
  })
})
