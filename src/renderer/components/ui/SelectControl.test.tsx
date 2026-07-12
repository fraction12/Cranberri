import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SelectControl } from './SelectControl'

describe('SelectControl', () => {
  it('reserves a standard trailing rail around its custom chevron', () => {
    const html = renderToStaticMarkup(<SelectControl aria-label="Model"><option>GPT-5.6-Sol</option></SelectControl>)

    expect(html).toContain('data-select-control="standard"')
    expect(html).toContain('appearance-none')
    expect(html).toContain('pl-3.5')
    expect(html).toContain('pr-10')
    expect(html).toContain('right-3')
  })

  it('uses the compact trailing rail without exposing the chevron to assistive technology', () => {
    const html = renderToStaticMarkup(<SelectControl density="compact" aria-label="Environment"><option>Local</option></SelectControl>)

    expect(html).toContain('data-select-control="compact"')
    expect(html).toContain('pl-2.5')
    expect(html).toContain('pr-8')
    expect(html).toContain('right-2.5')
    expect(html).toContain('aria-hidden="true"')
  })
})
