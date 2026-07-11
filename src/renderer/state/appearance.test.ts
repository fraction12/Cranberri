import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/settings'
import { applyVisualSettings, resolveAppearance } from './appearance'

describe('appearance resolution', () => {
  it('follows system color and motion preferences', () => {
    expect(resolveAppearance(DEFAULT_APP_SETTINGS.appearance, {
      dark: false,
      reducedMotion: true,
    })).toEqual({
      theme: 'light',
      reduceMotion: true,
      accent: 'green',
    })
  })

  it('honors explicit appearance overrides', () => {
    expect(resolveAppearance({
      ...DEFAULT_APP_SETTINGS.appearance,
      theme: 'dark',
      accent: 'rose',
      reducedMotion: 'off',
    }, {
      dark: false,
      reducedMotion: true,
    })).toEqual({
      theme: 'dark',
      reduceMotion: false,
      accent: 'rose',
    })
  })

  it('applies resolved tokens without changing the root layout scale', () => {
    const properties = new Map<string, string>()
    const classes = new Map<string, boolean>()
    const root = {
      dataset: {},
      style: {
        colorScheme: '',
        setProperty: (name: string, value: string) => properties.set(name, value),
      },
      classList: {
        toggle: (name: string, enabled: boolean) => classes.set(name, enabled),
      },
    } as unknown as HTMLElement
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      appearance: {
        ...DEFAULT_APP_SETTINGS.appearance,
        theme: 'light' as const,
        accent: 'blue' as const,
        typePreset: 'large' as const,
      },
      editor: { ...DEFAULT_APP_SETTINGS.editor, fontSize: 16 },
      terminal: { ...DEFAULT_APP_SETTINGS.terminal, fontSize: 17 },
    }

    applyVisualSettings(root, settings, resolveAppearance(settings.appearance, {
      dark: true,
      reducedMotion: true,
    }))

    expect(root.dataset).toEqual({
      theme: 'light',
      accent: 'blue',
      typePreset: 'large',
      reducedMotion: 'reduce',
    })
    expect(properties).toEqual(new Map([
      ['--app-code-font-size', '16px'],
      ['--app-terminal-font-size', '17px'],
    ]))
    expect(classes.get('dark')).toBe(false)
  })
})
