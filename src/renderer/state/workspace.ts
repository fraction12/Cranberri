import { useCallback, useEffect, useMemo } from 'react'
import { useRepos } from './repos'
import { useAppState } from './appState'
import { renameWorkspaceWindow } from './workspace-model'
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
  openBrowser: (options?: { id?: string; title?: string; url?: string; repoId?: string | null; processId?: string }) => string
  updateBrowserState: (id: string, browser: Partial<NonNullable<WorkspaceWindow['browser']>>) => void
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
      const currentWorkspace = current.workspacesByRepoId[targetRepoId] ?? defaultWorkspace()
      const nextWorkspace = mutator(currentWorkspace.windows, currentWorkspace.activeWindowId)
      if (
        nextWorkspace.windows === currentWorkspace.windows
        && nextWorkspace.activeWindowId === currentWorkspace.activeWindowId
      ) {
        return current
      }
      return {
        ...current,
        workspacesByRepoId: {
          ...current.workspacesByRepoId,
          [targetRepoId]: nextWorkspace,
        },
      }
    })
  }, [activeRepoId, updateAppState])

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

  const openBrowser = useCallback((options: { id?: string; title?: string; url?: string; repoId?: string | null; processId?: string } = {}) => {
    const windowId = options.id ?? generateId()
    const repoId = options.repoId ?? activeRepoId
    const profileId = repoId ? `repo-${repoId}` : 'default'
    mutateWorkspace(options.repoId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'browser').length + 1
      const url = options.url ?? 'about:blank'
      const newWindow: WorkspaceWindow = {
        id: windowId,
        type: 'browser',
        title: options.title ?? `Browser ${existingCount}`,
        browser: {
          url,
          title: options.title,
          profileId,
          viewportMode: 'responsive',
          devServerProcessId: options.processId,
        },
      }
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [activeRepoId, mutateWorkspace])

  const updateBrowserState = useCallback((id: string, browser: Partial<NonNullable<WorkspaceWindow['browser']>>) => {
    mutateWorkspace(null, (windows, activeWindowId) => ({
      windows: windows.map((w) => {
        if (w.id !== id || w.type !== 'browser') return w
        return {
          ...w,
          title: browser.title ?? w.title,
          browser: {
            url: browser.url ?? w.browser?.url ?? 'about:blank',
            profileId: browser.profileId ?? w.browser?.profileId ?? 'default',
            title: browser.title ?? w.browser?.title,
            viewportMode: browser.viewportMode ?? w.browser?.viewportMode ?? 'responsive',
            devServerProcessId: browser.devServerProcessId ?? w.browser?.devServerProcessId,
          },
        }
      }),
      activeWindowId,
    }))
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
      windows: renameWorkspaceWindow(windows, id, title),
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
    openBrowser,
    updateBrowserState,
    closeWindow,
    setActiveWindow,
    renameWindow,
  }
}
