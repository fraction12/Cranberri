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

  it('renders plugin and skill links as inline mention pills', () => {
    const html = renderToStaticMarkup(
      <>
        {formatInlineCodexText(
          'Use [@Computer](plugin://computer-use@openai-bundled) and [$compound-engineering:ce-plan](/Users/example/SKILL.md)',
        )}
      </>,
    )

    expect(html).toContain('@Computer')
    expect(html).toContain('$compound-engineering:ce-plan')
    expect(html).toContain('data-mention-kind="plugin"')
    expect(html).toContain('data-mention-kind="skill"')
    expect(html).not.toContain('plugin://computer-use@openai-bundled')
    expect(html).not.toContain('/Users/example/SKILL.md')
  })

  it('leaves ordinary markdown links literal in inline mode', () => {
    const html = renderToStaticMarkup(<>{formatInlineCodexText('Read [docs](https://example.com/docs) first')}</>)

    expect(html).toContain('[docs](https://example.com/docs)')
  })

  it('renders assistant plugin mentions without breaking normal links', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText('Use [@Computer](plugin://computer-use@openai-bundled), then open [#2](https://github.com/fraction12/Cranberri/pull/2).')}
      </>,
    )

    expect(html).toContain('@Computer')
    expect(html).toContain('data-mention-kind="plugin"')
    expect(html).not.toContain('plugin://computer-use@openai-bundled')
    expect(html).toContain('href="https://github.com/fraction12/Cranberri/pull/2"')
  })
})
