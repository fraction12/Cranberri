import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileChangeActivity } from './FileChangeActivity'

describe('FileChangeActivity', () => {
  it('summarizes patch statistics and preserves complete diffs', () => {
    const diff = ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1,2 +1,3 @@', '-old', '+new', '+another', ' same'].join('\n')
    const html = renderToStaticMarkup(
      <FileChangeActivity
        status="completed"
        detail={{ type: 'fileChange', changes: [{ path: 'src/app.ts', kind: 'update', diff }] }}
      />,
    )

    expect(html).toContain('Changed 1 file')
    expect(html).toContain('+2')
    expect(html).toContain('-1')
    expect(html).toContain('src/app.ts')
    expect(html).toContain('another')
    expect(html).toContain('max-h-80')
  })

  it('shows failures and safely formats malformed values', () => {
    const html = renderToStaticMarkup(
      <FileChangeActivity
        status="failed"
        detail={{
          type: 'fileChange',
          changes: [{ path: '', kind: { unexpected: true }, diff: '' }],
          applyStatus: { state: 'rejected' },
          error: new Error('Patch rejected'),
        }}
      />,
    )

    expect(html).toContain('File change failed')
    expect(html).toContain('Patch rejected')
    expect(html).toContain('rejected')
    expect(html).not.toContain('undefined')
  })

  it('renders an empty change set without inventing a patch', () => {
    const html = renderToStaticMarkup(<FileChangeActivity status="completed" detail={{ type: 'fileChange', changes: [] }} />)
    expect(html).toContain('No file changes')
    expect(html).not.toContain('<pre')
  })
})
