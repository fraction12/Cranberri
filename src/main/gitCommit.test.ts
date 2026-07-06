import { describe, expect, it } from 'vitest'
import { normalizeManualCommitMessage } from './gitCommit'

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
})
