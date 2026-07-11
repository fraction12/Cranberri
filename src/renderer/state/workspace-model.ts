import type { WorkspaceWindowState } from '../../shared/appState'
import type { TaskExecutionContext } from './execution-context'

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

export function createBoundWorkspaceWindow(
  window: Pick<WorkspaceWindowState, 'id' | 'type' | 'title' | 'browser'>,
  context: TaskExecutionContext,
): WorkspaceWindowState {
  return {
    ...window,
    projectId: context.projectId,
    taskId: context.taskId,
    checkoutId: context.checkoutId,
  }
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
