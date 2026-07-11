import { describe, expect, it } from 'vitest'
import { codeEditorSyntaxPalette, codeEditorThemeSpec } from './CodeEditor'

describe('CodeEditor theme adapter', () => {
  it('uses the shared mono size and line metrics', () => {
    const theme = codeEditorThemeSpec('dark')

    expect(theme['&'].fontSize).toBe('var(--app-code-font-size)')
    expect(theme['.cm-scroller']).toMatchObject({
      fontFamily: 'var(--app-font-mono)',
      lineHeight: '1.5',
    })
    expect(theme['.cm-panel.cm-search']).toMatchObject({
      fontFamily: 'var(--app-font-ui)',
      fontSize: 'var(--app-type-control-size)',
    })
  })

  it('provides distinct light and dark syntax and search treatments', () => {
    expect(codeEditorSyntaxPalette('light')).not.toEqual(codeEditorSyntaxPalette('dark'))
    expect(codeEditorThemeSpec('light')['.cm-searchMatch']).not.toEqual(codeEditorThemeSpec('dark')['.cm-searchMatch'])
  })
})
