import { useCallback, useEffect, useMemo } from 'react'
import { useRepos } from './repos'
import { useAppState } from './appState'
import type { WorkspaceWindowState, WorkspaceWindowType } from '@/shared/appState'

export type WorkspaceWindow = WorkspaceWindowState
export type { WorkspaceWindowType }

interface WorkspaceApi {
  windows: WorkspaceWindow[]
  activeWindowId: string | null
  activeRepoId: string | null
  activeRepoPath: string | null
  openChat: (id?: string, title?: string, repoId?: string | null) => string
  openTerminal: (id?: string, title?: string, repoId?: string | null) => string
  closeWindow: (id: string) => void
  setActiveWindow: (id: string) => void
  renameWindow: (id: string, title: string) => void
}

let nextId = 1

function generateId(): string {
  return `win-${Date.now()}-${nextId++}`
}

function defaultWorkspace() {
  const first: WorkspaceWindow = { id: generateId(), type: 'chat', title: 'Chat 1' }
  return { windows: [first], activeWindowId: first.id }
}

export function useWorkspace(): WorkspaceApi {
  const { activeRepoId, activeRepo } = useRepos()
  const { state, updateAppState } = useAppState()

  const workspace = useMemo(() => {
    if (!activeRepoId) return { windows: [], activeWindowId: null }
    return state.workspacesByRepoId[activeRepoId] ?? defaultWorkspace()
  }, [activeRepoId, state.workspacesByRepoId])

  const getWorkspaceForRepo = useCallback((repoId: string) => {
    return state.workspacesByRepoId[repoId] ?? defaultWorkspace()
  }, [state.workspacesByRepoId])

  useEffect(() => {
    if (!activeRepoId || state.workspacesByRepoId[activeRepoId]) return
    updateAppState((current) => {
      if (current.workspacesByRepoId[activeRepoId]) return current
      return {
        ...current,
        workspacesByRepoId: {
          ...current.workspacesByRepoId,
          [activeRepoId]: defaultWorkspace(),
        },
      }
    })
  }, [activeRepoId, state.workspacesByRepoId, updateAppState])

  const mutateWorkspace = useCallback((repoId: string | null | undefined, mutator: (windows: WorkspaceWindow[], activeWindowId: string | null) => { windows: WorkspaceWindow[]; activeWindowId: string | null }) => {
    const targetRepoId = repoId ?? activeRepoId
    if (!targetRepoId) return
    updateAppState((current) => {
      const currentWorkspace = current.workspacesByRepoId[targetRepoId] ?? getWorkspaceForRepo(targetRepoId)
      return {
        ...current,
        workspacesByRepoId: {
          ...current.workspacesByRepoId,
          [targetRepoId]: mutator(currentWorkspace.windows, currentWorkspace.activeWindowId),
        },
      }
    })
  }, [activeRepoId, getWorkspaceForRepo, updateAppState])

  const openChat = useCallback((id?: string, title?: string, repoId?: string | null) => {
    const windowId = id ?? generateId()
    mutateWorkspace(repoId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'chat').length + 1
      const newWindow: WorkspaceWindow = { id: windowId, type: 'chat', title: title ?? `Chat ${existingCount}` }
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [mutateWorkspace])

  const openTerminal = useCallback((id?: string, title?: string, repoId?: string | null) => {
    const windowId = id ?? generateId()
    mutateWorkspace(repoId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'terminal').length + 1
      const newWindow: WorkspaceWindow = { id: windowId, type: 'terminal', title: title ?? `Terminal ${existingCount}` }
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [mutateWorkspace])

  const closeWindow = useCallback((id: string) => {
    mutateWorkspace(null, (currentWindows, currentActiveWindowId) => {
      const windows = currentWindows.filter((w) => w.id !== id)
      let activeWindowId = currentActiveWindowId
      if (activeWindowId === id) {
        const idx = currentWindows.findIndex((w) => w.id === id)
        activeWindowId = windows[idx - 1]?.id ?? windows[idx]?.id ?? null
      }
      return { windows, activeWindowId }
    })
  }, [mutateWorkspace])

  const setActiveWindow = useCallback((id: string) => {
    mutateWorkspace(null, (windows) => ({ windows, activeWindowId: id }))
  }, [mutateWorkspace])

  const renameWindow = useCallback((id: string, title: string) => {
    mutateWorkspace(null, (windows, activeWindowId) => ({
      windows: windows.map((w) => (w.id === id ? { ...w, title } : w)),
      activeWindowId,
    }))
  }, [mutateWorkspace])

  return {
    windows: workspace.windows,
    activeWindowId: workspace.activeWindowId,
    activeRepoId,
    activeRepoPath: activeRepo?.path ?? null,
    openChat,
    openTerminal,
    closeWindow,
    setActiveWindow,
    renameWindow,
  }
}
