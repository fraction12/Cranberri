import { describe, expect, it } from 'vitest'
import type { LatestGitHubContext } from './github-chat-context'
import { createGitHubContextCapturedEvent, GITHUB_CONTEXT_CAPTURED_EVENT, githubContextFromEvent } from './github-context-events'

const context: LatestGitHubContext = {
  kind: 'item',
  label: 'smoke/context',
  text: 'GitHub item context:\nKind: branches\nTitle: smoke/context',
  repoPath: '/repo/cranberri',
}

describe('github context events', () => {
  it('round-trips captured GitHub context', () => {
    const event = createGitHubContextCapturedEvent(context)

    expect(event.type).toBe(GITHUB_CONTEXT_CAPTURED_EVENT)
    expect(githubContextFromEvent(event)).toEqual(context)
  })

  it('ignores non-GitHub context events', () => {
    expect(githubContextFromEvent(new Event(GITHUB_CONTEXT_CAPTURED_EVENT))).toBeNull()
    expect(githubContextFromEvent(new CustomEvent(GITHUB_CONTEXT_CAPTURED_EVENT, { detail: {} }))).toBeNull()
  })
})
