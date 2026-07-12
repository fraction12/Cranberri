import { createContext, useContext, useEffect, useState } from 'react'
import type { ProjectWithLocalCheckout } from '@/shared/projects'

export type Project = Pick<ProjectWithLocalCheckout, 'id' | 'name' | 'path'>
  & Partial<Omit<ProjectWithLocalCheckout, 'id' | 'name' | 'path'>>

/** Compatibility alias while repo-oriented UI migrates to project language. */
export type Repo = Project

interface ReposState {
  repos: Repo[]
  projects: Project[]
  activeRepoId: string | null
  activeRepo: Repo | null
  activeProjectId: string | null
  activeProject: Project | null
}

interface ReposApi extends ReposState {
  addRepo: () => Promise<void>
  removeRepo: (id: string) => Promise<void>
  setActiveRepo: (id: string) => Promise<void>
  setPinnedBranch: (id: string, branch: string) => Promise<void>
  refresh: () => Promise<void>
}

const ReposContext = createContext<ReposApi | null>(null)

export function ReposProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ReposState>({
    repos: [],
    projects: [],
    activeRepoId: null,
    activeRepo: null,
    activeProjectId: null,
    activeProject: null,
  })

  const refresh = async () => {
    const data = await window.cranberri.repos.list()
    const activeRepo = data.repos.find((r) => r.id === data.activeRepoId) ?? null
    setState({
      ...data,
      projects: data.repos,
      activeRepo,
      activeProjectId: data.activeRepoId,
      activeProject: activeRepo,
    })
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

  const setPinnedBranch = async (id: string, branch: string) => {
    await window.cranberri.repos.setPinnedBranch(id, branch)
    await refresh()
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <ReposContext.Provider value={{ ...state, addRepo, removeRepo, setActiveRepo, setPinnedBranch, refresh }}>
      {children}
    </ReposContext.Provider>
  )
}

export function useRepos(): ReposApi {
  const ctx = useContext(ReposContext)
  if (!ctx) throw new Error('useRepos must be used inside ReposProvider')
  return ctx
}
