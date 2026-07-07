import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatCodexText, formatInlineCodexText } from './Transcript'

describe('Transcript markdown rendering', () => {
  it('renders assistant markdown while hiding Codex app directives', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText(
          [
            'Done. Opened PR [#1](https://github.com/fraction12/Cranberri/pull/1) into `origin/main`.',
            '',
            'Verified:',
            '- PR state: `MERGED`',
            '- Working tree is clean',
            '',
            '::git-create-pr{cwd="/repo" branch="codex/example" url="https://github.com/fraction12/Cranberri/pull/1" isDraft=false}',
          ].join('\n'),
          { hideAppDirectives: true },
        )}
      </>,
    )

    expect(html).toContain('href="https://github.com/fraction12/Cranberri/pull/1"')
    expect(html).toContain('<ul')
    expect(html).toContain('<code')
    expect(html).toContain('origin/main')
    expect(html).not.toContain('::git-create-pr')
  })

  it('keeps composer text inline', () => {
    const html = renderToStaticMarkup(<>{formatInlineCodexText('Use `main` now')}</>)

    expect(html).toContain('Use ')
    expect(html).toContain('<code')
    expect(html).toContain('main')
  })
})
