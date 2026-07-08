import type { BrowserWindowState } from '@/shared/appState'

export type BrowserViewportMode = NonNullable<BrowserWindowState['viewportMode']>

export interface BrowserViewportProfile {
  mode: BrowserViewportMode
  label: string
  width: number | null
  height: number | null
}

export interface BrowserViewportFrame {
  width: string
  height: string
  label: string
}

export const BROWSER_VIEWPORT_PROFILES: BrowserViewportProfile[] = [
  { mode: 'responsive', label: 'Responsive', width: null, height: null },
  { mode: 'mobile', label: 'Mobile 390x844', width: 390, height: 844 },
  { mode: 'tablet', label: 'Tablet 820x1180', width: 820, height: 1180 },
  { mode: 'desktop', label: 'Desktop 1440x900', width: 1440, height: 900 },
]

export function browserViewportProfile(mode: BrowserViewportMode | undefined): BrowserViewportProfile {
  return BROWSER_VIEWPORT_PROFILES.find((profile) => profile.mode === mode) ?? BROWSER_VIEWPORT_PROFILES[0]
}

export function browserViewportFrame(mode: BrowserViewportMode | undefined, available: { width: number; height: number }): BrowserViewportFrame {
  const profile = browserViewportProfile(mode)
  if (!profile.width || !profile.height) {
    return {
      width: '100%',
      height: '100%',
      label: profile.label,
    }
  }

  return {
    width: `${Math.max(1, Math.min(profile.width, Math.floor(available.width)))}px`,
    height: `${Math.max(1, Math.min(profile.height, Math.floor(available.height)))}px`,
    label: profile.label,
  }
}
