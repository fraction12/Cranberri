import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_APP_STATE, type CranberriAppState } from '@/shared/appState'

interface AppStateApi {
  state: CranberriAppState
  loaded: boolean
  updateAppState: (updater: (state: CranberriAppState) => CranberriAppState) => void
  setProjectExpanded: (projectId: string, expanded: boolean) => void
}

export function withProjectExpanded(
  state: CranberriAppState,
  projectId: string,
  expanded: boolean,
): CranberriAppState {
  if (state.expandedProjectIds[projectId] === expanded) return state
  return {
    ...state,
    expandedProjectIds: { ...state.expandedProjectIds, [projectId]: expanded },
  }
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

  useEffect(() => {
    const flush = (event: Event) => {
      if (!loaded) return
      const detail = (event as CustomEvent<{ writes: Promise<unknown>[] }>).detail
      detail?.writes.push(window.cranberri.appState.write(state))
    }
    window.addEventListener('cranberri:flush-persistence', flush)
    return () => window.removeEventListener('cranberri:flush-persistence', flush)
  }, [loaded, state])

  const updateAppState = useCallback((updater: (state: CranberriAppState) => CranberriAppState) => {
    setState((current) => updater(current))
  }, [])

  const setProjectExpanded = useCallback((projectId: string, expanded: boolean) => {
    setState((current) => withProjectExpanded(current, projectId, expanded))
  }, [])

  const value = useMemo(
    () => ({ state, loaded, updateAppState, setProjectExpanded }),
    [loaded, setProjectExpanded, state, updateAppState],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateApi {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used inside AppStateProvider')
  return context
}
