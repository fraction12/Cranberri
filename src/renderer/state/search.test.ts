import { describe, expect, it } from 'vitest'
import { repoWatcherStartErrorIsBenign } from './search'

describe('repo watcher startup errors', () => {
  it('treats checkout removal races as cancellation', () => {
    expect(repoWatcherStartErrorIsBenign(new Error('Task worktree checkout not found'))).toBe(true)
    expect(repoWatcherStartErrorIsBenign(new Error('Task not found'))).toBe(true)
  })

  it('keeps unexpected watcher failures visible', () => {
    expect(repoWatcherStartErrorIsBenign(new Error('EMFILE: too many open files'))).toBe(false)
  })
})
