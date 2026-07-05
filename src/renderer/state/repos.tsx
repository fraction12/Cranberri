import { createContext, useContext, useEffect, useState } from 'react'

export interface Repo {
  id: string
  name: string
  path: string
}

interface ReposState {
  repos: Repo[]
  activeRepoId: string | null
  activeRepo: Repo | null
}

interface ReposApi extends ReposState {
  addRepo: () => Promise<void>
  removeRepo: (id: string) => Promise<void>
  setActiveRepo: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const ReposContext = createContext<ReposApi | null>(null)

export function ReposProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ReposState>({ repos: [], activeRepoId: null, activeRepo: null })

  const refresh = async () => {
    const data = await window.cranberri.repos.list()
    const activeRepo = data.repos.find((r) => r.id === data.activeRepoId) ?? null
    setState({ ...data, activeRepo })
  }

  const addRepo = async () => {
    const path = await window.cranberri.repos.pickDirectory()
    if (!path) return
    await window.cranberri.repos.add(path)
    await refresh()
  }

  const removeRepo = async (id: string) => {
    await window.cranberri.repos.remove(id)
    await refresh()
  }

  const setActiveRepo = async (id: string) => {
    await window.cranberri.repos.setActive(id)
    await refresh()
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <ReposContext.Provider value={{ ...state, addRepo, removeRepo, setActiveRepo, refresh }}>
      {children}
    </ReposContext.Provider>
  )
}

export function useRepos(): ReposApi {
  const ctx = useContext(ReposContext)
  if (!ctx) throw new Error('useRepos must be used inside ReposProvider')
  return ctx
}
