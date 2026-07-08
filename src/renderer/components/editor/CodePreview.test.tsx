import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodePreview } from './CodePreview'

describe('CodePreview', () => {
  it('server-renders a plain fallback before Shiki loads', () => {
    const html = renderToStaticMarkup(<CodePreview code="const value = 1" language="typescript" />)

    expect(html).toContain('data-code-preview="true"')
    expect(html).toContain('data-language="typescript"')
    expect(html).toContain('aria-label="Copy code"')
    expect(html).toContain('const value = 1')
  })

  it('renders bounded large previews without requiring syntax highlighting', () => {
    const html = renderToStaticMarkup(<CodePreview code={'a\nb\nc'} language="text" maxLines={2} />)

    expect(html).toContain('a\nb')
    expect(html).not.toContain('c</code>')
    expect(html).toContain('Showing 2 of 3 lines.')
  })

  it('shows the focused line when opened from search', () => {
    const code = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n')
    const html = renderToStaticMarkup(<CodePreview code={code} filePath="src/App.tsx" focusLine={12} />)

    expect(html).toContain('line 12')
    expect(html).toContain('data-focused-line="true"')
  })

  it('renders a compact focused window for large search results', () => {
    const code = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
    const html = renderToStaticMarkup(<CodePreview code={code} language="text" focusLine={6} maxLines={3} />)

    expect(html).toContain('Earlier lines hidden')
    expect(html).toContain('Later lines hidden')
    expect(html).toContain('Showing lines 5-7 of 10.')
    expect(html).toContain('line 6')
    expect(html).not.toContain('line 1</code>')
  })
})
