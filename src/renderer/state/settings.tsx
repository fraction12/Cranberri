import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@/shared/settings'
import { applyVisualSettings, resolveAppearance } from './appearance'
import { AppearanceProvider } from './appearance-context'
import { SettingsWriteQueue } from './settings-write-queue'

interface SettingsApi {
  settings: AppSettings
  loading: boolean
  status: 'loading' | 'ready' | 'error'
  error: string | null
  retry: () => Promise<void>
  update: (next: Partial<AppSettings>) => Promise<void>
  updateSection: <Section extends keyof AppSettings>(
    section: Section,
    update: Partial<AppSettings[Section]> | ((current: AppSettings[Section]) => Partial<AppSettings[Section]>),
  ) => Promise<void>
}

const SettingsContext = createContext<SettingsApi | null>(null)

function currentSystemAppearance(): { dark: boolean; reducedMotion: boolean } {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { dark: true, reducedMotion: false }
  }
  return {
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [status, setStatus] = useState<SettingsApi['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const statusRef = useRef<SettingsApi['status']>('loading')
  const [systemAppearance, setSystemAppearance] = useState(currentSystemAppearance)
  const writeQueueRef = useRef<SettingsWriteQueue | null>(null)
  if (!writeQueueRef.current) {
    writeQueueRef.current = new SettingsWriteQueue(
      DEFAULT_APP_SETTINGS,
      async (next) => (await window.cranberri.settings.set(next)).settings,
      setSettings,
      false,
    )
  }

  const loadSettings = useCallback(async () => {
    statusRef.current = 'loading'
    setStatus('loading')
    setError(null)
    try {
      const { settings: data } = await window.cranberri.settings.get()
      writeQueueRef.current?.replace(data)
      setSettings(data)
      statusRef.current = 'ready'
      setStatus('ready')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Settings could not be loaded'
      console.error('Failed to load settings:', loadError)
      statusRef.current = 'error'
      setStatus('error')
      setError(message)
    }
  }, [])

  useEffect(() => { void loadSettings() }, [loadSettings])

  useEffect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateSystemAppearance = () => setSystemAppearance({
      dark: darkQuery.matches,
      reducedMotion: reducedMotionQuery.matches,
    })
    darkQuery.addEventListener('change', updateSystemAppearance)
    reducedMotionQuery.addEventListener('change', updateSystemAppearance)
    return () => {
      darkQuery.removeEventListener('change', updateSystemAppearance)
      reducedMotionQuery.removeEventListener('change', updateSystemAppearance)
    }
  }, [])

  const appearance = useMemo(
    () => resolveAppearance(settings.appearance, systemAppearance),
    [settings.appearance, systemAppearance],
  )

  useLayoutEffect(() => {
    applyVisualSettings(document.documentElement, settings, appearance)
  }, [appearance, settings])

  const update = useCallback(async (next: Partial<AppSettings>) => {
    if (statusRef.current !== 'ready') throw new Error('Settings are unavailable. Retry loading before making changes.')
    await writeQueueRef.current?.enqueue((current) => ({ ...current, ...next }))
  }, [])

  const updateSection = useCallback(async <Section extends keyof AppSettings>(
    section: Section,
    update: Partial<AppSettings[Section]> | ((current: AppSettings[Section]) => Partial<AppSettings[Section]>),
  ) => {
    if (statusRef.current !== 'ready') throw new Error('Settings are unavailable. Retry loading before making changes.')
    await writeQueueRef.current?.enqueue((current) => {
      const values = typeof update === 'function' ? update(current[section]) : update
      return {
        ...current,
        [section]: { ...current[section], ...values },
      }
    })
  }, [])

  return (
    <SettingsContext.Provider value={{
      settings,
      loading: status === 'loading',
      status,
      error,
      retry: loadSettings,
      update,
      updateSection,
    }}>
      <AppearanceProvider value={appearance}>
        {children}
      </AppearanceProvider>
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
