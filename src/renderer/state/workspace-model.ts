import type { RepoWorkspaceState, WorkspaceWindowState } from '../../shared/appState'
import type { Task } from '../../shared/tasks'
import type { TaskExecutionContext } from './execution-context'

export const BIND_WORKSPACE_WINDOW_THREAD_EVENT = 'cranberri:bind-workspace-window-thread'

function nextBindingRevision(window: Pick<WorkspaceWindowState, 'bindingRevision'>): number {
  const revision = window.bindingRevision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Cannot increment binding revision')
  }
  return revision + 1
}

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
    ...(context.sessionTarget ? { sessionTarget: context.sessionTarget } : {}),
    bindingRevision: 0,
  }
}

export function bindWorkspaceWindowThread(
  window: WorkspaceWindowState,
  threadId: string,
): WorkspaceWindowState {
  return {
    ...window,
    threadId,
    bindingRevision: nextBindingRevision(window),
  }
}

export function rebindWorkspaceWindowExecutionContext(
  window: WorkspaceWindowState,
  context: TaskExecutionContext,
): WorkspaceWindowState {
  return {
    ...window,
    projectId: context.projectId,
    taskId: context.taskId,
    checkoutId: context.checkoutId,
    ...(context.sessionTarget ? { sessionTarget: context.sessionTarget } : {}),
    bindingRevision: nextBindingRevision(window),
  }
}

export function localProjectExecutionContext(project: { id: string; path: string; localCheckoutId?: string }): TaskExecutionContext {
  return {
    projectId: project.id,
    taskId: null,
    checkoutId: project.localCheckoutId ?? `local:${project.id}`,
    worktreeId: null,
    checkoutPath: project.path,
    sessionTarget: 'local',
  }
}

export function executionContextForNewToolWindow(
  explicitContext: TaskExecutionContext | undefined,
  activeContext: TaskExecutionContext | null,
  localContext: TaskExecutionContext | null,
): TaskExecutionContext | null {
  return explicitContext ?? activeContext ?? localContext
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
        bindingRevision: nextBindingRevision(window),
      }
    })
    if (!workspaceChanged) return [projectId, workspace]
    changed = true
    return [projectId, { ...workspace, windows }]
  }))
  return changed ? repaired : workspaces
}

export function closeSessionChatWindows(
  workspace: RepoWorkspaceState,
  identity: { threadId: string; taskId?: string | null },
): RepoWorkspaceState {
  const shouldClose = (window: WorkspaceWindowState) => window.type === 'chat' && (
    window.threadId === identity.threadId
    || window.id === `session-${identity.threadId}`
    || Boolean(identity.taskId && window.taskId === identity.taskId)
  )
  const closingIds = new Set(workspace.windows.filter(shouldClose).map((window) => window.id))
  if (closingIds.size === 0) return workspace

  const windows = workspace.windows.filter((window) => !closingIds.has(window.id))
  if (!workspace.activeWindowId || !closingIds.has(workspace.activeWindowId)) {
    return { ...workspace, windows }
  }

  const activeIndex = workspace.windows.findIndex((window) => window.id === workspace.activeWindowId)
  const previous = workspace.windows.slice(0, activeIndex).reverse().find((window) => !closingIds.has(window.id))
  const next = workspace.windows.slice(activeIndex + 1).find((window) => !closingIds.has(window.id))
  return { windows, activeWindowId: previous?.id ?? next?.id ?? null }
}

export function codexThreadIdForActiveWindow(
  windows: WorkspaceWindowState[],
  activeWindowId: string | null,
  tasks: ReadonlyArray<Pick<Task, 'id' | 'threadId'>> = [],
): string | null {
  const activeWindow = windows.find((window) => window.id === activeWindowId)
  if (!activeWindow) return null
  if (activeWindow.type === 'chat') return activeWindow.threadId ?? null
  return tasks.find((task) => task.id === activeWindow.taskId)?.threadId ?? null
}

export function chatWindowForExecutionContext(
  windows: WorkspaceWindowState[],
  activeWindowId: string | null,
): WorkspaceWindowState | undefined {
  const activeWindow = windows.find((window) => window.id === activeWindowId)
  if (activeWindow?.type === 'chat') return activeWindow
  const chats = windows.filter((window) => window.type === 'chat')
  if (!activeWindow) return chats[0]
  return chats.find((window) => Boolean(activeWindow.taskId) && window.taskId === activeWindow.taskId)
    ?? chats.find((window) => window.checkoutId === activeWindow.checkoutId && window.projectId === activeWindow.projectId)
    ?? chats.find((window) => window.projectId === activeWindow.projectId)
    ?? chats[0]
}
