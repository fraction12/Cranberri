import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@/shared/settings'

interface SettingsApi {
  settings: AppSettings
  loading: boolean
  update: (next: Partial<AppSettings>) => Promise<void>
  updateSection: <Section extends keyof AppSettings>(
    section: Section,
    values: Partial<AppSettings[Section]>,
  ) => Promise<void>
}

const SettingsContext = createContext<SettingsApi | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.cranberri.settings.get()
      .then(({ settings: data }) => setSettings(data))
      .catch((err) => console.error('Failed to load settings:', err))
      .finally(() => setLoading(false))
  }, [])

  const persist = useCallback(async (next: AppSettings) => {
    const { settings: saved } = await window.cranberri.settings.set(next)
    setSettings(saved)
  }, [])

  const update = useCallback(async (next: Partial<AppSettings>) => {
    await persist({ ...settings, ...next })
  }, [settings, persist])

  const updateSection = useCallback(async <Section extends keyof AppSettings>(
    section: Section,
    values: Partial<AppSettings[Section]>,
  ) => {
    await persist({
      ...settings,
      [section]: { ...settings[section], ...values },
    })
  }, [settings, persist])

  return (
    <SettingsContext.Provider value={{ settings, loading, update, updateSection }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
