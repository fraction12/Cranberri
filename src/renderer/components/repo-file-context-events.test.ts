import { describe, expect, it } from 'vitest'
import { createRepoFileContextCapturedEvent, REPO_FILE_CONTEXT_CAPTURED_EVENT, repoFileContextFromEvent } from './repo-file-context-events'

describe('repo file context events', () => {
  it('round-trips captured repo file context', () => {
    const context = {
      repoPath: '/repo/project',
      file: { path: 'README.md', status: 'tracked' as const },
      workingContent: 'hello',
    }
    const event = createRepoFileContextCapturedEvent(context)

    expect(event.type).toBe(REPO_FILE_CONTEXT_CAPTURED_EVENT)
    expect(repoFileContextFromEvent(event)).toEqual(context)
  })

  it('ignores non-context events', () => {
    expect(repoFileContextFromEvent(new Event('other'))).toBeNull()
    expect(repoFileContextFromEvent(new CustomEvent(REPO_FILE_CONTEXT_CAPTURED_EVENT, { detail: { repoPath: '/repo/project' } }))).toBeNull()
  })
})
