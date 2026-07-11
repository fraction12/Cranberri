import { describe, expect, it } from 'vitest'
import { terminalTheme, terminalTypographyOptions } from './terminal-theme'

const ANSI_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('terminal theme', () => {
  it.each([8, 13, 24])('uses shared terminal metrics at %ipx', (fontSize) => {
    expect(terminalTypographyOptions(fontSize, ' Shared Mono, monospace ')).toEqual({
      fontFamily: 'Shared Mono, monospace',
      fontSize,
      lineHeight: 1.3,
      minimumContrastRatio: 4.5,
    })
  })

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

  it.each(['light', 'dark'] as const)('keeps every ANSI color readable in the %s theme', (themeName) => {
    const theme = terminalTheme(themeName)

    for (const colorName of ANSI_COLORS) {
      const color = theme[colorName]
      expect(color, `${themeName}.${colorName} is defined`).toBeTypeOf('string')
      expect(
        contrastRatio(color!, theme.background!),
        `${themeName}.${colorName} contrasts with the terminal background`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
