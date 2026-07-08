import { describe, expect, it } from 'vitest'
import { repoChangesChatContext, repoChangesExplanationChatContext, repoChangesPullRequestChatContext, repoChangesReviewChatContext, repoChangesTestPlanChatContext, repoFileChatContext } from './repo-chat-context'
import type { DiffResult, GitFileStatus } from '@/shared/git'

const FILE: GitFileStatus = { path: 'README.md', status: 'modified' }

const DIFF: DiffResult = {
  files: [{
    to: 'README.md',
    additions: 1,
    deletions: 1,
    chunks: [{
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      changes: [
        { type: 'normal', line: ' # Project', ln1: 1, ln2: 1 },
        { type: 'del', line: '-old copy', delLine: 2, ln1: 2 },
        { type: 'add', line: '+new copy', addLine: 2, ln2: 2 },
      ],
    }],
  }],
}

describe('repo chat context', () => {
  it('formats selected file diff and working content for chat', () => {
    const context = repoFileChatContext({
      repoPath: '/repo/project',
      file: FILE,
      workingContent: '# Project\nnew copy',
      diff: DIFF,
    })

    expect(context).toContain('Repo file context:')
    expect(context).toContain('Path: README.md')
    expect(context).toContain('@@ -1,3 +1,3 @@')
    expect(context).toContain('+new copy')
    expect(context).toContain('Working content:')
  })

  it('uses HEAD content for deleted files', () => {
    const context = repoFileChatContext({
      repoPath: '/repo/project',
      file: { path: 'gone.ts', status: 'deleted' },
      headContent: 'export const gone = true',
      diff: null,
    })

    expect(context).toContain('Status: deleted')
    expect(context).toContain('HEAD content:')
    expect(context).toContain('export const gone = true')
  })

  it('keeps newest content when context is too large', () => {
    const context = repoFileChatContext({
      repoPath: '/repo/project',
      file: FILE,
      workingContent: `${'x'.repeat(17000)}\nlatest-line`,
      diff: null,
    })

    expect(context).toContain('latest-line')
    expect(context).toContain('Repo context truncated')
  })

  it('formats repo status context for chat', () => {
    const context = repoChangesChatContext({
      repoPath: '/repo/project',
      status: [
        { path: 'README.md', status: 'modified' },
        { path: 'src/new.ts', status: 'untracked' },
      ],
    })

    expect(context).toContain('Repo status context:')
    expect(context).toContain('Repo: /repo/project')
    expect(context).toContain('- modified: README.md')
    expect(context).toContain('- untracked: src/new.ts')
    expect(context).not.toContain('Diff hunks:')
  })

  it('formats repo diff context for chat', () => {
    const context = repoChangesChatContext({
      repoPath: '/repo/project',
      status: [FILE],
      diff: DIFF,
    })

    expect(context).toContain('Repo diff context:')
    expect(context).toContain('Diff summary:')
    expect(context).toContain('- README.md: +1/-1')
    expect(context).toContain('diff -- README.md')
    expect(context).toContain('@@ -1,3 +1,3 @@')
    expect(context).toContain('+new copy')
  })

  it('formats a repo changes review prompt for chat', () => {
    const context = repoChangesReviewChatContext({
      repoPath: '/repo/project',
      status: [FILE],
      diff: DIFF,
    })

    expect(context).toContain('Review these repo changes.')
    expect(context).toContain('Prioritize correctness bugs')
    expect(context).toContain('Repo diff context:')
    expect(context).toContain('- README.md: +1/-1')
    expect(context).toContain('+new copy')
  })

  it('formats a repo changes explanation prompt for chat', () => {
    const context = repoChangesExplanationChatContext({
      repoPath: '/repo/project',
      status: [FILE],
      diff: DIFF,
    })

    expect(context).toContain('Explain these repo changes.')
    expect(context).toContain('Summarize what changed, why it likely matters')
    expect(context).toContain('Repo diff context:')
    expect(context).toContain('- README.md: +1/-1')
    expect(context).toContain('+new copy')
  })

  it('formats a repo changes test-writing prompt for chat', () => {
    const context = repoChangesTestPlanChatContext({
      repoPath: '/repo/project',
      status: [FILE],
      diff: DIFF,
    })

    expect(context).toContain('Write or update tests for these repo changes.')
    expect(context).toContain('Start by identifying the behavior changed by the diff')
    expect(context).toContain('Repo diff context:')
    expect(context).toContain('- README.md: +1/-1')
    expect(context).toContain('+new copy')
  })

  it('formats a repo changes pull request prompt for chat', () => {
    const context = repoChangesPullRequestChatContext({
      repoPath: '/repo/project',
      status: [FILE],
      diff: DIFF,
    })

    expect(context).toContain('Draft a pull request description for these repo changes.')
    expect(context).toContain('Include Summary, Testing, and Risks sections')
    expect(context).toContain('Repo diff context:')
    expect(context).toContain('- README.md: +1/-1')
    expect(context).toContain('+new copy')
  })
})
