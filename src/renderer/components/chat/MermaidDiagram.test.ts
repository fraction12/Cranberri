import { describe, expect, it } from 'vitest'
import { mermaidTypographyFromCss } from './MermaidDiagram'

describe('MermaidDiagram typography', () => {
  it('reads the shared UI family and preset-relative body size from computed CSS', () => {
    const values: Record<string, string> = {
      '--app-font-ui': ' Inter, sans-serif ',
      '--app-type-body-size': ' 14px ',
    }

    expect(mermaidTypographyFromCss((property) => values[property] ?? '')).toEqual({
      fontFamily: 'Inter, sans-serif',
      fontSize: '14px',
    })
  })
})
