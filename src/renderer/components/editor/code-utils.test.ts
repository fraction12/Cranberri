import { describe, expect, it } from 'vitest'
import { boundedCodeText, displayLanguage, focusedCodePreview, languageFromFileName, languageFromMarkdownClass } from './code-utils'

describe('code editor utilities', () => {
  it('detects languages from file names and markdown classes', () => {
    expect(languageFromFileName('src/App.tsx')).toBe('tsx')
    expect(languageFromFileName('README.md')).toBe('markdown')
    expect(languageFromFileName('Dockerfile')).toBe('dockerfile')
    expect(languageFromMarkdownClass('language-ts')).toBe('typescript')
    expect(languageFromMarkdownClass('language-madeup')).toBe('madeup')
    expect(displayLanguage(undefined, 'notes.unknown')).toBe('text')
  })

  it('bounds large code previews by line count', () => {
    const bounded = boundedCodeText(['one', 'two', 'three'].join('\n'), 2)

    expect(bounded).toEqual({
      text: 'one\ntwo',
      truncated: true,
      lineCount: 3,
    })
  })

  it('windows focused previews around the requested line', () => {
    const preview = focusedCodePreview(['one', 'two', 'three', 'four', 'five'].join('\n'), 3, 4)

    expect(preview).toEqual({
      lines: [
        { number: 3, text: 'three', focused: false },
        { number: 4, text: 'four', focused: true },
        { number: 5, text: 'five', focused: false },
      ],
      lineCount: 5,
      truncatedBefore: true,
      truncatedAfter: false,
      focusLine: 4,
    })
  })

  it('clamps focused previews to real file lines', () => {
    const preview = focusedCodePreview(['one', 'two'].join('\n'), 5, 99)

    expect(preview.lines.map((line) => line.focused)).toEqual([false, true])
    expect(preview.focusLine).toBe(2)
  })
})
