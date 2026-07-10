import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatCodexText } from './MarkdownContent'
import { formatInlineCodexText } from './mention-pill'
import { markdownMediaChatContext, markdownMediaImageInput, markdownMediaSourceFromUrl } from './MarkdownMedia'
import { assistantResponseChatContext, latestReusableAssistantMessage, latestReusableUserMessage, userPromptChatContext } from './assistant-response-context'
import { TranscriptMessage } from './Transcript'

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
            '<promise>DONE</promise>',
            '<promise>',
            'HIDDEN MULTILINE RESULT',
            '</promise>',
            '<oai-mem-citation>',
            '<citation_entries>hidden</citation_entries>',
            '</oai-mem-citation>',
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
    expect(html).not.toContain('&lt;promise&gt;')
    expect(html).not.toContain('HIDDEN MULTILINE RESULT')
    expect(html).not.toContain('oai-mem-citation')
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

  it('renders markdown code blocks through the shared code preview fallback', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText(['```ts', 'const value = 1', '```'].join('\n'))}
      </>,
    )

    expect(html).toContain('data-code-preview="true"')
    expect(html).toContain('data-language="typescript"')
    expect(html).toContain('const value = 1')
  })

  it('keeps streaming code blocks lightweight until the message completes', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText(['```ts', 'const value = 1', '```'].join('\n'), { streaming: true })}
      </>,
    )

    expect(html).toContain('data-streaming-markdown="true"')
    expect(html).toContain('const value = 1')
    expect(html).not.toContain('data-code-preview="true"')
  })

  it('hides response actions until streaming completes', () => {
    const pending = renderToStaticMarkup(
      <TranscriptMessage
        msg={{ id: 'pending', role: 'assistant', content: 'Still working', timestamp: 1, pending: true }}
        renderSkillText={(text) => [text]}
      />,
    )
    const completed = renderToStaticMarkup(
      <TranscriptMessage
        msg={{ id: 'completed', role: 'assistant', content: 'Done', timestamp: 1 }}
        renderSkillText={(text) => [text]}
      />,
    )

    expect(pending).not.toContain('Copy response')
    expect(completed).toContain('Copy response')
  })

  it('uses the same typography for user and assistant messages', () => {
    const user = renderToStaticMarkup(
      <TranscriptMessage
        msg={{ id: 'user', role: 'user', content: 'Please inspect this', timestamp: 1 }}
        renderSkillText={(text) => [text]}
      />,
    )
    const assistant = renderToStaticMarkup(
      <TranscriptMessage
        msg={{ id: 'assistant', role: 'assistant', content: 'I inspected it', timestamp: 2 }}
        renderSkillText={(text) => [text]}
      />,
    )

    expect(user).toContain('text-base leading-7')
    expect(assistant).toContain('text-base leading-7')
    expect(user).not.toContain('text-sm leading-5')
    expect(assistant).not.toContain('text-sm leading-5')
  })

  it('renders Mermaid code blocks through the diagram surface', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText(['```mermaid', 'flowchart TD', '  A[Plan] --> B[Ship]', '```'].join('\n'))}
      </>,
    )

    expect(html).toContain('data-mermaid-diagram="true"')
    expect(html).toContain('Rendering Mermaid diagram...')
    expect(html).not.toContain('data-code-preview="true"')
  })

  it('renders local markdown images through the media preview surface', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText('![Smoke image](/Users/example/Cranberri/smoke.png)')}
      </>,
    )

    expect(html).toContain('data-markdown-media="image"')
    expect(html).toContain('src="cranberri-media://local/?path=%2FUsers%2Fexample%2FCranberri%2Fsmoke.png"')
    expect(html).toContain('alt="Smoke image"')
    expect(html).toContain('aria-label="Send image to chat"')
  })

  it('formats local markdown images as reusable visual chat context', () => {
    const source = markdownMediaSourceFromUrl('/Users/example/Cranberri/smoke.png')

    expect(source?.localPath).toBe('/Users/example/Cranberri/smoke.png')
    expect(source?.openUrl).toBe('file:///Users/example/Cranberri/smoke.png')
    expect(source ? markdownMediaImageInput(source) : null).toEqual({ type: 'localImage', path: '/Users/example/Cranberri/smoke.png', detail: 'high' })
    expect(source ? markdownMediaChatContext(source, 'Smoke image') : '').toContain('Image from assistant markdown:')
    expect(source ? markdownMediaChatContext(source, 'Smoke image') : '').toContain('- Label: Smoke image')
    expect(source ? markdownMediaChatContext(source, 'Smoke image') : '').toContain('- Path: /Users/example/Cranberri/smoke.png')
  })

  it('formats remote and inline markdown images as reusable visual chat input', () => {
    const remote = markdownMediaSourceFromUrl('https://example.com/smoke.png')
    const inline = markdownMediaSourceFromUrl('data:image/png;base64,AAAA')
    const video = markdownMediaSourceFromUrl('https://example.com/demo.webm')

    expect(remote ? markdownMediaImageInput(remote) : null).toEqual({ type: 'image', url: 'https://example.com/smoke.png', detail: 'high' })
    expect(remote ? markdownMediaChatContext(remote, 'Remote image') : '').toContain('- Source: https://example.com/smoke.png')
    expect(inline ? markdownMediaImageInput(inline) : null).toEqual({ type: 'image', url: 'data:image/png;base64,AAAA', detail: 'high' })
    expect(inline ? markdownMediaChatContext(inline, 'Inline image') : '').toContain('- Source: inline data image')
    expect(video ? markdownMediaImageInput(video) : null).toBeNull()
  })

  it('renders video links through the media preview surface', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText('[Demo clip](https://example.com/demo.webm)')}
      </>,
    )

    expect(html).toContain('data-markdown-media="video"')
    expect(html).toContain('src="https://example.com/demo.webm"')
    expect(html).toContain('Demo clip')
  })

  it('does not render unsafe image URLs as media', () => {
    const html = renderToStaticMarkup(
      <>
        {formatCodexText('![Nope](javascript:alert(1))')}
      </>,
    )

    expect(html).not.toContain('data-markdown-media=')
    expect(html).toContain('Nope')
    expect(html).not.toContain('javascript:alert')
  })

  it('formats assistant responses as bounded reusable chat context', () => {
    const context = assistantResponseChatContext([
      'Here is the useful answer.',
      '<promise>',
      'HIDDEN MULTILINE RESULT',
      '</promise>',
      '::git-stage{cwd="/repo"}',
    ].join('\n'))

    expect(context).toContain('Assistant response context:')
    expect(context).toContain('Here is the useful answer.')
    expect(context).not.toContain('::git-stage')
    expect(context).not.toContain('<promise>')
    expect(context).not.toContain('HIDDEN MULTILINE RESULT')

    const longContext = assistantResponseChatContext('x'.repeat(12_050))
    expect(longContext).toContain('truncated 50 more characters')
    expect(longContext.length).toBeLessThan(12_120)
  })

  it('selects the latest completed assistant message for reuse', () => {
    const message = latestReusableAssistantMessage([
      { id: 'user-1', role: 'user', content: 'Question', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'First answer', timestamp: 2 },
      { id: 'assistant-pending', role: 'assistant', content: 'Still streaming', timestamp: 3, pending: true },
      { id: 'assistant-empty', role: 'assistant', content: '   ', timestamp: 4 },
    ])

    expect(message?.id).toBe('assistant-1')
  })

  it('formats user prompts as bounded reusable chat context', () => {
    const context = userPromptChatContext('Please inspect this flow.')
    expect(context).toBe('User prompt context:\nPlease inspect this flow.')

    const longContext = userPromptChatContext('x'.repeat(12_050))
    expect(longContext).toContain('truncated 50 more characters')
    expect(longContext.length).toBeLessThan(12_120)
  })

  it('selects the latest completed user message for reuse', () => {
    const message = latestReusableUserMessage([
      { id: 'user-1', role: 'user', content: 'First prompt', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: 'Answer', timestamp: 2 },
      { id: 'user-pending', role: 'user', content: 'Still sending', timestamp: 3, pending: true },
      { id: 'user-empty', role: 'user', content: '   ', timestamp: 4 },
    ])

    expect(message?.id).toBe('user-1')
  })
})
