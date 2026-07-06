import { useState, useCallback } from 'react'

export type WorkspaceWindowType = 'chat' | 'terminal'

export interface WorkspaceWindow {
  id: string
  type: WorkspaceWindowType
  title: string
}

interface WorkspaceState {
  windows: WorkspaceWindow[]
  activeWindowId: string | null
}

interface WorkspaceApi extends WorkspaceState {
  openChat: (id?: string, title?: string) => string
  openTerminal: (id?: string, title?: string) => string
  closeWindow: (id: string) => void
  setActiveWindow: (id: string) => void
  renameWindow: (id: string, title: string) => void
}

let nextId = 1

function generateId(): string {
  return `win-${Date.now()}-${nextId++}`
}

export function useWorkspace(): WorkspaceApi {
  const [state, setState] = useState<WorkspaceState>(() => {
    const first = generateId()
    return {
      windows: [{ id: first, type: 'chat', title: 'Chat 1' }],
      activeWindowId: first,
    }
  })

  const openChat = useCallback((id?: string, title?: string) => {
    const existing = state.windows.filter((w) => w.type === 'chat').length + 1
    const newWindow: WorkspaceWindow = { id: id ?? generateId(), type: 'chat', title: title ?? `Chat ${existing}` }
    setState((prev) => ({ windows: [...prev.windows.filter((window) => window.id !== newWindow.id), newWindow], activeWindowId: newWindow.id }))
    return newWindow.id
  }, [state.windows])

  const openTerminal = useCallback((id?: string, title?: string) => {
    const windowId = id ?? generateId()
    setState((prev) => {
      const existingWindow = prev.windows.find((w) => w.id === windowId)
      if (existingWindow) return { ...prev, activeWindowId: windowId }
      const existing = prev.windows.filter((w) => w.type === 'terminal').length + 1
      const newWindow: WorkspaceWindow = { id: windowId, type: 'terminal', title: title ?? `Terminal ${existing}` }
      return { windows: [...prev.windows, newWindow], activeWindowId: newWindow.id }
    })
    return windowId
  }, [])

  const closeWindow = useCallback((id: string) => {
    setState((prev) => {
      const windows = prev.windows.filter((w) => w.id !== id)
      let activeWindowId = prev.activeWindowId
      if (activeWindowId === id) {
        const idx = prev.windows.findIndex((w) => w.id === id)
        activeWindowId = windows[idx - 1]?.id ?? windows[idx]?.id ?? null
      }
      return { windows, activeWindowId }
    })
  }, [])

  const setActiveWindow = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeWindowId: id }))
  }, [])

  const renameWindow = useCallback((id: string, title: string) => {
    setState((prev) => ({
      ...prev,
      windows: prev.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    }))
  }, [])

  return {
    ...state,
    openChat,
    openTerminal,
    closeWindow,
    setActiveWindow,
    renameWindow,
  }
}
