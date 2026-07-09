import type { AppSettings } from '@/shared/settings'

export type ResolvedAppTheme = 'light' | 'dark'

export interface SystemAppearancePreferences {
  dark: boolean
  reducedMotion: boolean
}

export interface ResolvedAppearance {
  theme: ResolvedAppTheme
  reduceMotion: boolean
  accent: AppSettings['appearance']['accent']
}

export function resolveAppearance(
  appearance: AppSettings['appearance'],
  system: SystemAppearancePreferences,
): ResolvedAppearance {
  return {
    theme: appearance.theme === 'system' ? (system.dark ? 'dark' : 'light') : appearance.theme,
    reduceMotion: appearance.reducedMotion === 'system'
      ? system.reducedMotion
      : appearance.reducedMotion === 'on',
    accent: appearance.accent,
  }
}

export function applyVisualSettings(
  root: HTMLElement,
  settings: AppSettings,
  resolved: ResolvedAppearance,
): void {
  root.dataset.theme = resolved.theme
  root.dataset.accent = resolved.accent
  root.dataset.reducedMotion = resolved.reduceMotion ? 'reduce' : 'no-preference'
  root.style.colorScheme = resolved.theme
  root.style.setProperty('--app-ui-font-size', `${settings.appearance.uiFontSize}px`)
  root.style.setProperty('--app-code-font-size', `${settings.editor.fontSize}px`)
  root.style.setProperty('--app-terminal-font-size', `${settings.terminal.fontSize}px`)
  root.classList.toggle('dark', resolved.theme === 'dark')
}
