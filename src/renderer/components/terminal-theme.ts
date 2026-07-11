import type { ITheme } from '@xterm/xterm'
import type { ResolvedAppTheme } from '../state/appearance'

export function terminalTheme(theme: ResolvedAppTheme): ITheme {
  if (theme === 'light') {
    return {
      background: '#fcfcfd',
      foreground: '#1f2023',
      cursor: '#63636c',
      selectionBackground: '#bfdbfe',
      black: '#1f2023',
      red: '#dc2626',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0e7490',
      white: '#f6f6f8',
      brightBlack: '#6b7280',
      brightRed: '#ef4444',
      brightGreen: '#16a34a',
      brightYellow: '#ca8a04',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#0891b2',
      brightWhite: '#ffffff',
    }
  }
  return {
    background: '#111113',
    foreground: '#f4f4f5',
    cursor: '#a6a6af',
    selectionBackground: '#3f3f46',
    black: '#17171a',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#f4f4f5',
    brightBlack: '#2c2c31',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  }
}
