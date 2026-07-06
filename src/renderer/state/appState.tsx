import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_APP_STATE, type CranberriAppState } from '@/shared/appState'

interface AppStateApi {
  state: CranberriAppState
  loaded: boolean
  updateAppState: (updater: (state: CranberriAppState) => CranberriAppState) => void
}

const AppStateContext = createContext<AppStateApi | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CranberriAppState>(DEFAULT_APP_STATE)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.cranberri.appState.read()
      .then((next) => {
        if (cancelled) return
        setState(next)
        setLoaded(true)
      })
      .catch((error) => {
        console.error('Failed to load Cranberri app state:', error)
        if (!cancelled) setLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loaded) return
    const id = window.setTimeout(() => {
      window.cranberri.appState.write(state).catch((error) => console.error('Failed to save Cranberri app state:', error))
    }, 200)
    return () => window.clearTimeout(id)
  }, [loaded, state])

  const updateAppState = useCallback((updater: (state: CranberriAppState) => CranberriAppState) => {
    setState((current) => updater(current))
  }, [])

  const value = useMemo(() => ({ state, loaded, updateAppState }), [loaded, state, updateAppState])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateApi {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used inside AppStateProvider')
  return context
}
