import type { ITheme } from '@xterm/xterm'
import type { ResolvedAppTheme } from '../state/appearance'

export function terminalTheme(theme: ResolvedAppTheme): ITheme {
  if (theme === 'light') {
    return {
      background: '#f7f7f8',
      foreground: '#202123',
      cursor: '#67676f',
      selectionBackground: '#bfdbfe',
      black: '#202123',
      red: '#dc2626',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0e7490',
      white: '#f7f7f8',
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
    background: '#0f0f11',
    foreground: '#fafafa',
    cursor: '#a1a1aa',
    selectionBackground: '#3f3f46',
    black: '#18181b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#fafafa',
    brightBlack: '#27272a',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  }
}
