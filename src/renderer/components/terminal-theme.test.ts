import { describe, expect, it } from 'vitest'
import { terminalTheme } from './terminal-theme'

describe('terminal theme', () => {
  it('uses readable light and dark palettes', () => {
    expect(terminalTheme('light')).toMatchObject({
      background: '#fcfcfd',
      foreground: '#1f2023',
    })
    expect(terminalTheme('dark')).toMatchObject({
      background: '#111113',
      foreground: '#f4f4f5',
    })
  })
})
