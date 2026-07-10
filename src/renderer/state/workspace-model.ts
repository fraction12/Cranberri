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
