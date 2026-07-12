import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextInputChips } from './ContextInputChips'

describe('ContextInputChips', () => {
  it('preserves the context attachment selector and accessible remove action', () => {
    const html = renderToStaticMarkup(
      <ContextInputChips
        attachments={[{
          id: 'terminal-context',
          label: 'Terminal output',
          input: { type: 'text', text: 'npm test passed' },
        }]}
        onRemove={() => undefined}
      />,
    )

    expect(html).toContain('data-composer-attachments="context"')
    expect(html).toContain('aria-label="Remove context attachment Terminal output"')
    expect(html).toContain('Terminal output')
  })

  it('renders nothing without attachments', () => {
    expect(renderToStaticMarkup(<ContextInputChips attachments={[]} onRemove={() => undefined} />)).toBe('')
  })
})
