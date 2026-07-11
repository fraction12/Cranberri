import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import type { ResolvedAppTheme } from '../state/appearance'
import { TERMINAL_LINE_HEIGHT } from '../lib/typography'

const TERMINAL_FONT_FALLBACK = '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace'

export function terminalTypographyOptions(
  fontSize: number,
  sharedMonoStack?: string,
): Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'lineHeight' | 'minimumContrastRatio'> {
  return {
    fontFamily: sharedMonoStack?.trim() || TERMINAL_FONT_FALLBACK,
    fontSize,
    lineHeight: TERMINAL_LINE_HEIGHT,
    minimumContrastRatio: 4.5,
  }
}

export function terminalTheme(theme: ResolvedAppTheme): ITheme {
  if (theme === 'light') {
    return {
      background: '#fcfcfd',
      foreground: '#1f2023',
      cursor: '#63636c',
      selectionBackground: '#bfdbfe',
      black: '#1f2023',
      red: '#b91c1c',
      green: '#166534',
      yellow: '#854d0e',
      blue: '#1d4ed8',
      magenta: '#7e22ce',
      cyan: '#155e75',
      white: '#4b5563',
      brightBlack: '#374151',
      brightRed: '#dc2626',
      brightGreen: '#15803d',
      brightYellow: '#a16207',
      brightBlue: '#2563eb',
      brightMagenta: '#9333ea',
      brightCyan: '#0e7490',
      brightWhite: '#374151',
    }
  }
  return {
    background: '#111113',
    foreground: '#f4f4f5',
    cursor: '#a6a6af',
    selectionBackground: '#3f3f46',
    black: '#a1a1aa',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#f4f4f5',
    brightBlack: '#d4d4d8',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  }
}
