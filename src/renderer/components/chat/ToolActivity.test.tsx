import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolActivity } from './ToolActivity'

describe('ToolActivity', () => {
  it('renders MCP arguments, result, context, and duration', () => {
    const html = renderToStaticMarkup(
      <ToolActivity
        status="completed"
        detail={{
          type: 'mcpToolCall',
          server: 'github',
          tool: 'search_issues',
          arguments: { query: 'is:open label:bug' },
          result: { total: 2, items: ['one', 'two'] },
          durationMs: 250,
          appContext: {
            connectorId: 'github',
            linkId: 'link-1',
            resourceUri: 'github://issues',
            appName: 'GitHub',
            templateId: null,
            actionName: 'Search issues',
          },
        }}
      />,
    )

    expect(html).toContain('github.search_issues')
    expect(html).toContain('Completed')
    expect(html).toContain('is:open label:bug')
    expect(html).toContain('&quot;total&quot;: 2')
    expect(html).toContain('GitHub')
    expect(html).toContain('250ms')
  })

  it('renders dynamic content, image inputs, and structured failures', () => {
    const large = { text: 'x'.repeat(400) }
    const html = renderToStaticMarkup(
      <ToolActivity
        status="failed"
        detail={{
          type: 'dynamicToolCall',
          namespace: 'image',
          tool: 'inspect',
          arguments: large,
          contentItems: [
            { type: 'inputText', text: 'Inspect this screenshot' },
            { type: 'inputImage', imageUrl: 'https://example.com/screenshot.png' },
          ],
          success: false,
          error: { code: 'BAD_IMAGE', message: 'Could not inspect image' },
        }}
      />,
    )

    expect(html).toContain('image.inspect')
    expect(html).toContain('Failed')
    expect(html).toContain('Inspect this screenshot')
    expect(html).toContain('https://example.com/screenshot.png')
    expect(html).toContain('Could not inspect image')
    expect(html).toContain('truncate')
  })

  it('handles empty and circular tool payloads', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const empty = renderToStaticMarkup(<ToolActivity status="running" detail={{ type: 'mcpToolCall' }} />)
    const malformed = renderToStaticMarkup(
      <ToolActivity status="completed" detail={{ type: 'dynamicToolCall', arguments: circular, result: BigInt(12) }} />,
    )

    expect(empty).toContain('Running tool')
    expect(empty).toContain('No tool details')
    expect(malformed).toContain('[Circular]')
    expect(malformed).toContain('12n')
  })
})
