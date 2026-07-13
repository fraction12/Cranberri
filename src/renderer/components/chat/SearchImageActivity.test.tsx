import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SearchImageActivity } from './SearchImageActivity'

describe('SearchImageActivity', () => {
  it('renders structured search actions', () => {
    const search = renderToStaticMarkup(
      <SearchImageActivity
        status="running"
        detail={{ type: 'webSearch', query: 'Codex app-server', action: { type: 'search', query: 'Codex app-server', queries: ['Codex protocol', 'Codex app-server'] } }}
      />,
    )
    const find = renderToStaticMarkup(
      <SearchImageActivity
        status="completed"
        detail={{ type: 'webSearch', action: { type: 'findInPage', url: 'https://example.com/docs', pattern: 'approval' } }}
      />,
    )

    expect(search).toContain('Searching the web')
    expect(search).toContain('Codex protocol')
    expect(find).toContain('Found in page')
    expect(find).toContain('approval')
    expect(find).toContain('https://example.com/docs')
  })

  it('renders real image view and generation sources with prompts', () => {
    const view = renderToStaticMarkup(
      <SearchImageActivity status="completed" detail={{ type: 'imageView', path: '/tmp/reference.png' }} />,
    )
    const generation = renderToStaticMarkup(
      <SearchImageActivity
        status="completed"
        detail={{
          type: 'imageGeneration',
          generationStatus: 'completed',
          revisedPrompt: 'A compact desktop coding cockpit',
          result: 'https://example.com/generated.png',
          savedPath: '/tmp/generated.png',
        }}
      />,
    )

    expect(view).toContain('cranberri-media://local/?path=%2Ftmp%2Freference.png')
    expect(generation).toContain('https://example.com/generated.png')
    expect(generation).toContain('A compact desktop coding cockpit')
    expect(generation).toContain('/tmp/generated.png')
    expect(generation).not.toContain('src=""')
  })

  it('uses honest failed and empty states without blank media', () => {
    const failed = renderToStaticMarkup(
      <SearchImageActivity status="failed" detail={{ type: 'imageGeneration', generationStatus: 'failed', result: '' }} />,
    )
    const empty = renderToStaticMarkup(<SearchImageActivity status="completed" detail={{ type: 'imageView', path: '' }} />)

    expect(failed).toContain('Image generation failed')
    expect(empty).toContain('No image details')
    expect(`${failed}${empty}`).not.toContain('<img')
  })

  it('does not expose inline image payloads as transcript text', () => {
    const dataImage = 'data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%3E%3C%2Fsvg%3E'
    const html = renderToStaticMarkup(
      <SearchImageActivity
        status="completed"
        detail={{ type: 'imageGeneration', revisedPrompt: 'Synthetic image', result: dataImage }}
      />,
    )

    expect(html).toContain(`src="${dataImage}`)
    expect(html).toContain('Synthetic image')
    expect(html).not.toContain(`>${dataImage}<`)
  })
})
