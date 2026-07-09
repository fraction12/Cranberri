import { describe, expect, it } from 'vitest'
import { terminalTheme } from './terminal-theme'

describe('terminal theme', () => {
  it('uses readable light and dark palettes', () => {
    expect(terminalTheme('light')).toMatchObject({
      background: '#f7f7f8',
      foreground: '#202123',
    })
    expect(terminalTheme('dark')).toMatchObject({
      background: '#0f0f11',
      foreground: '#fafafa',
    })
  })
})
