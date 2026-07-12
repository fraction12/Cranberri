import type { RepoWorkspaceState, WorkspaceWindowState } from '../../shared/appState'
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
  window: Pick<WorkspaceWindowState, 'id' | 'type' | 'title' | 'browser' | 'sessionTarget'>,
  context: TaskExecutionContext,
): WorkspaceWindowState {
  return {
    ...window,
    projectId: context.projectId,
    taskId: context.taskId,
    checkoutId: context.checkoutId,
  }
}

export function repairStaleLocalWorkspaceBindings(
  workspaces: Record<string, RepoWorkspaceState>,
  projects: ReadonlyArray<{ id: string; localCheckoutId?: string }>,
  taskIds: ReadonlySet<string>,
): Record<string, RepoWorkspaceState> {
  const localCheckoutByProject = new Map(projects.map((project) => [project.id, project.localCheckoutId]))
  let changed = false
  const repaired = Object.fromEntries(Object.entries(workspaces).map(([projectId, workspace]) => {
    const localCheckoutId = localCheckoutByProject.get(projectId)
    if (!localCheckoutId) return [projectId, workspace]
    let workspaceChanged = false
    const windows = workspace.windows.map((window) => {
      if (!window.taskId || taskIds.has(window.taskId) || window.checkoutId !== localCheckoutId) return window
      workspaceChanged = true
      return {
        ...window,
        title: window.title === 'Local control' ? 'New local session' : window.title,
        taskId: null,
        sessionTarget: window.type === 'chat' ? 'local' as const : window.sessionTarget,
      }
    })
    if (!workspaceChanged) return [projectId, workspace]
    changed = true
    return [projectId, { ...workspace, windows }]
  }))
  return changed ? repaired : workspaces
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
