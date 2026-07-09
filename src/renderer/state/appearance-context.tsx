import { createContext, useContext } from 'react'
import type { ResolvedAppearance } from './appearance'

const AppearanceContext = createContext<ResolvedAppearance>({
  theme: 'dark',
  reduceMotion: false,
  accent: 'green',
})

export function AppearanceProvider({
  value,
  children,
}: {
  value: ResolvedAppearance
  children: React.ReactNode
}) {
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): ResolvedAppearance {
  return useContext(AppearanceContext)
}
