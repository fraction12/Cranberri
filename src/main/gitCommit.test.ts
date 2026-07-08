import { describe, expect, it } from 'vitest'
import {
  buildCommitMessageDraftPrompt,
  normalizeManualCommitMessage,
  parseGeneratedCommitMessage,
  truncateCommitMessageDraftContext,
} from './gitCommit'

describe('normalizeManualCommitMessage', () => {
  it('trims title and summary for manual commit input', () => {
    expect(normalizeManualCommitMessage('  fix(git): commit manually  ', '  Let the user provide commit text.  ')).toEqual({
      title: 'fix(git): commit manually',
      summary: 'Let the user provide commit text.',
    })
  })

  it('allows an empty summary but rejects empty or multiline titles', () => {
    expect(normalizeManualCommitMessage('chore: commit', '')).toEqual({ title: 'chore: commit', summary: '' })
    expect(() => normalizeManualCommitMessage('', 'body')).toThrow('Commit title is required')
    expect(() => normalizeManualCommitMessage('bad\ntitle', 'body')).toThrow('Commit title must be one line')
  })

  it('parses generated commit message JSON from Codex output', () => {
    expect(parseGeneratedCommitMessage('```json\n{"title":"feat(git): draft commits","summary":"Adds a draft button."}\n```')).toEqual({
      title: 'feat(git): draft commits',
      summary: 'Adds a draft button.',
    })
  })

  it('falls back to first-line generated commit output', () => {
    expect(parseGeneratedCommitMessage('fix(git): handle draft failures\n\nKeep the manual path usable.')).toEqual({
      title: 'fix(git): handle draft failures',
      summary: 'Keep the manual path usable.',
    })
  })

  it('builds a bounded commit draft prompt with current git context', () => {
    const context = truncateCommitMessageDraftContext('a'.repeat(20), 10)
    expect(context).toContain('[truncated')

    const prompt = buildCommitMessageDraftPrompt({
      statusSummary: 'M src/app.ts',
      stagedDiff: '',
      unstagedDiff: 'diff --git a/src/app.ts b/src/app.ts',
    })
    expect(prompt).toContain('Return only JSON')
    expect(prompt).toContain('M src/app.ts')
    expect(prompt).toContain('diff --git')
  })
})
