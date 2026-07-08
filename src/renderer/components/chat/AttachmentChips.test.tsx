import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AttachmentChips } from './AttachmentChips'

describe('AttachmentChips', () => {
  it('renders local image attachments as visual previews', () => {
    const html = renderToStaticMarkup(
      <AttachmentChips
        attachments={['/Users/example/Desktop/smoke image.png']}
        onRemove={() => {}}
      />,
    )

    expect(html).toContain('data-composer-attachments="files"')
    expect(html).toContain('src="cranberri-media://local/?path=%2FUsers%2Fexample%2FDesktop%2Fsmoke%20image.png"')
    expect(html).toContain('smoke image.png')
    expect(html).toContain('aria-label="Remove attached file smoke image.png"')
  })

  it('renders non-image attachments without thumbnail previews', () => {
    const html = renderToStaticMarkup(
      <AttachmentChips
        attachments={['/Users/example/Desktop/notes.txt']}
        onRemove={() => {}}
      />,
    )

    expect(html).toContain('notes.txt')
    expect(html).not.toContain('cranberri-media://local/')
  })
})
