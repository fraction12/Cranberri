import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@/shared/settings'
import { SettingsWriteQueue } from './settings-write-queue'

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
  const writeQueueRef = useRef<SettingsWriteQueue | null>(null)
  if (!writeQueueRef.current) {
    writeQueueRef.current = new SettingsWriteQueue(
      DEFAULT_APP_SETTINGS,
      async (next) => (await window.cranberri.settings.set(next)).settings,
      setSettings,
    )
  }

  useEffect(() => {
    window.cranberri.settings.get()
      .then(({ settings: data }) => {
        writeQueueRef.current?.replace(data)
        setSettings(data)
      })
      .catch((err) => console.error('Failed to load settings:', err))
      .finally(() => setLoading(false))
  }, [])

  const update = useCallback(async (next: Partial<AppSettings>) => {
    await writeQueueRef.current?.enqueue((current) => ({ ...current, ...next }))
  }, [])

  const updateSection = useCallback(async <Section extends keyof AppSettings>(
    section: Section,
    values: Partial<AppSettings[Section]>,
  ) => {
    await writeQueueRef.current?.enqueue((current) => ({
      ...current,
      [section]: { ...current[section], ...values },
    }))
  }, [])

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
