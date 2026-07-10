import type { WorkspaceWindowState } from '../../shared/appState'

export function renameWorkspaceWindow(
  windows: WorkspaceWindowState[],
  id: string,
  title: string,
): WorkspaceWindowState[] {
  const index = windows.findIndex((window) => window.id === id)
  if (index === -1 || windows[index].title === title) return windows

  const next = [...windows]
  next[index] = { ...windows[index], title }
  return next
}

export function codexThreadIdForActiveWindow(
  windows: WorkspaceWindowState[],
  activeWindowId: string | null,
  activeThreadId: string | null,
): string | null {
  return windows.find((window) => window.id === activeWindowId)?.type === 'chat'
    ? activeThreadId
    : null
}
