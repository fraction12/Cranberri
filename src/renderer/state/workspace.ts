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
  openChat: () => void
  openTerminal: () => void
  closeWindow: (id: string) => void
  setActiveWindow: (id: string) => void
  renameWindow: (id: string, title: string) => void
}

let nextId = 1

function generateId(): string {
  return `win-${Date.now()}-${nextId++}`
}

export function useWorkspace(): WorkspaceApi {
  const [state, setState] = useState<WorkspaceState>({
    windows: [{ id: generateId(), type: 'chat', title: 'Chat 1' }],
    activeWindowId: null,
  })

  const openChat = useCallback(() => {
    setState((prev) => {
      const existing = prev.windows.filter((w) => w.type === 'chat').length + 1
      const newWindow: WorkspaceWindow = { id: generateId(), type: 'chat', title: `Chat ${existing}` }
      return { windows: [...prev.windows, newWindow], activeWindowId: newWindow.id }
    })
  }, [])

  const openTerminal = useCallback(() => {
    setState((prev) => {
      const existing = prev.windows.filter((w) => w.type === 'terminal').length + 1
      const newWindow: WorkspaceWindow = { id: generateId(), type: 'terminal', title: `Terminal ${existing}` }
      return { windows: [...prev.windows, newWindow], activeWindowId: newWindow.id }
    })
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
