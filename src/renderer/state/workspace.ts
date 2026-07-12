import { useCallback, useEffect, useMemo } from 'react'
import { useRepos } from './repos'
import { useAppState } from './appState'
import { bindWorkspaceWindowThread, closeSessionChatWindows, createBoundWorkspaceWindow, executionContextForNewToolWindow, localProjectExecutionContext, rebindWorkspaceWindowExecutionContext, renameWorkspaceWindow, repairStaleLocalWorkspaceBindings } from './workspace-model'
import { useOptionalTasks } from './tasks'
import { resolveTaskExecutionContext, type ExecutionContextResolution, type TaskExecutionContext } from './execution-context'
import type { SessionExecutionTarget, WorkspaceWindowState, WorkspaceWindowType } from '@/shared/appState'

export type WorkspaceWindow = WorkspaceWindowState
export type { WorkspaceWindowType }

interface WorkspaceApi {
  windows: WorkspaceWindow[]
  activeWindowId: string | null
  activeRepoId: string | null
  activeRepoPath: string | null
  activeProjectId: string | null
  activeCheckoutPath: string | null
  activeExecutionContext: TaskExecutionContext | null
  activeExecutionResolution: ExecutionContextResolution | null
  openChat: (id?: string, title?: string, projectId?: string | null, context?: TaskExecutionContext, sessionTarget?: SessionExecutionTarget) => string
  openTerminal: (id?: string, title?: string, projectId?: string | null, context?: TaskExecutionContext) => string
  openBrowser: (options?: { id?: string; title?: string; url?: string; repoId?: string | null; processId?: string; context?: TaskExecutionContext }) => string
  updateBrowserState: (id: string, browser: Partial<NonNullable<WorkspaceWindow['browser']>>) => void
  closeWindow: (id: string) => void
  closeSessionWindows: (projectId: string, identity: { threadId: string; taskId?: string | null }) => void
  setActiveWindow: (id: string) => void
  renameWindow: (id: string, title: string) => void
  bindWindowToTask: (windowId: string, context: TaskExecutionContext) => void
  bindWindowToThread: (windowId: string, threadId: string, projectId?: string | null) => void
}

let nextId = 1

function generateId(): string {
  return `win-${Date.now()}-${nextId++}`
}

function defaultWorkspace(context: TaskExecutionContext) {
  const first = createBoundWorkspaceWindow({ id: generateId(), type: 'chat', title: 'New local session', sessionTarget: 'local' }, context)
  return { windows: [first], activeWindowId: first.id }
}

export function useWorkspace(): WorkspaceApi {
  const { activeProjectId, activeProject, projects } = useRepos()
  const tasks = useOptionalTasks()
  const { state, updateAppState } = useAppState()

  const contextForProject = useCallback((projectId: string): TaskExecutionContext | null => {
    const project = projects.find((candidate) => candidate.id === projectId)
    return project ? localProjectExecutionContext(project) : null
  }, [projects])

  const workspace = useMemo(() => {
    if (!activeProjectId) return { windows: [], activeWindowId: null }
    return state.workspacesByProjectId[activeProjectId] ?? { windows: [], activeWindowId: null }
  }, [activeProjectId, state.workspacesByProjectId])

  const activeWindow = workspace.windows.find((window) => window.id === workspace.activeWindowId) ?? null
  const activeExecutionResolution = activeWindow && tasks?.loading
    ? null
    : activeWindow && tasks
      ? resolveTaskExecutionContext(activeWindow, tasks)
      : activeWindow && activeProject
        ? { status: 'available' as const, context: localProjectExecutionContext(activeProject) }
        : null
  const activeExecutionContext = activeExecutionResolution?.status === 'available'
    ? activeExecutionResolution.context
    : null

  useEffect(() => {
    if (!activeProjectId || state.workspacesByProjectId[activeProjectId]) return
    const context = contextForProject(activeProjectId)
    if (!context) return
    updateAppState((current) => {
      if (current.workspacesByProjectId[activeProjectId]) return current
      return {
        ...current,
        workspacesByProjectId: {
          ...current.workspacesByProjectId,
          [activeProjectId]: defaultWorkspace(context),
        },
      }
    })
  }, [activeProjectId, contextForProject, state.workspacesByProjectId, updateAppState])

  useEffect(() => {
    if (!tasks || tasks.loading || projects.length === 0) return
    const taskIds = new Set(tasks.tasks.map((task) => task.id))
    updateAppState((current) => {
      const workspacesByProjectId = repairStaleLocalWorkspaceBindings(current.workspacesByProjectId, projects, taskIds)
      if (workspacesByProjectId === current.workspacesByProjectId) return current
      return { ...current, workspacesByProjectId }
    })
  }, [projects, tasks, updateAppState])

  const mutateWorkspace = useCallback((projectId: string | null | undefined, mutator: (windows: WorkspaceWindow[], activeWindowId: string | null) => { windows: WorkspaceWindow[]; activeWindowId: string | null }) => {
    const targetProjectId = projectId ?? activeProjectId
    if (!targetProjectId) return
    updateAppState((current) => {
      const currentWorkspace = current.workspacesByProjectId[targetProjectId] ?? { windows: [], activeWindowId: null }
      const nextWorkspace = mutator(currentWorkspace.windows, currentWorkspace.activeWindowId)
      if (
        nextWorkspace.windows === currentWorkspace.windows
        && nextWorkspace.activeWindowId === currentWorkspace.activeWindowId
      ) {
        return current
      }
      return {
        ...current,
        workspacesByProjectId: {
          ...current.workspacesByProjectId,
          [targetProjectId]: nextWorkspace,
        },
      }
    })
  }, [activeProjectId, updateAppState])

  const openChat = useCallback((id?: string, title?: string, projectId?: string | null, explicitContext?: TaskExecutionContext, sessionTarget: SessionExecutionTarget = 'local') => {
    const windowId = id ?? generateId()
    const targetProjectId = projectId ?? activeProjectId
    const context = explicitContext ?? (targetProjectId ? contextForProject(targetProjectId) : null)
    if (!context) return windowId
    mutateWorkspace(targetProjectId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'chat').length + 1
      const newWindow = createBoundWorkspaceWindow({ id: windowId, type: 'chat', title: title ?? `Chat ${existingCount}`, sessionTarget }, context)
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [activeProjectId, contextForProject, mutateWorkspace])

  const openTerminal = useCallback((id?: string, title?: string, projectId?: string | null, explicitContext?: TaskExecutionContext) => {
    const windowId = id ?? generateId()
    const targetProjectId = projectId ?? activeProjectId
    const context = executionContextForNewToolWindow(
      explicitContext,
      targetProjectId === activeProjectId ? activeExecutionContext : null,
      targetProjectId ? contextForProject(targetProjectId) : null,
    )
    if (!context) return windowId
    mutateWorkspace(targetProjectId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'terminal').length + 1
      const newWindow = createBoundWorkspaceWindow({ id: windowId, type: 'terminal', title: title ?? `Terminal ${existingCount}` }, context)
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [activeExecutionContext, activeProjectId, contextForProject, mutateWorkspace])

  const openBrowser = useCallback((options: { id?: string; title?: string; url?: string; repoId?: string | null; processId?: string; context?: TaskExecutionContext } = {}) => {
    const windowId = options.id ?? generateId()
    const projectId = options.repoId ?? activeProjectId
    const context = executionContextForNewToolWindow(
      options.context,
      projectId === activeProjectId ? activeExecutionContext : null,
      projectId ? contextForProject(projectId) : null,
    )
    if (!context) return windowId
    const profileId = `project-${context.projectId}`
    mutateWorkspace(projectId, (windows) => {
      const existingWindow = windows.find((w) => w.id === windowId)
      if (existingWindow) return { windows, activeWindowId: windowId }
      const existingCount = windows.filter((w) => w.type === 'browser').length + 1
      const url = options.url ?? 'about:blank'
      const newWindow = createBoundWorkspaceWindow({
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
      }, context)
      return { windows: [...windows, newWindow], activeWindowId: windowId }
    })
    return windowId
  }, [activeExecutionContext, activeProjectId, contextForProject, mutateWorkspace])

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

  const closeSessionWindows = useCallback((projectId: string, identity: { threadId: string; taskId?: string | null }) => {
    mutateWorkspace(projectId, (windows, activeWindowId) => closeSessionChatWindows({ windows, activeWindowId }, identity))
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

  const bindWindowToTask = useCallback((windowId: string, context: TaskExecutionContext) => {
    mutateWorkspace(context.projectId, (windows, activeWindowId) => ({
      windows: windows.map((window) => window.id === windowId
        ? rebindWorkspaceWindowExecutionContext(window, context)
        : window),
      activeWindowId: windowId || activeWindowId,
    }))
  }, [mutateWorkspace])

  const bindWindowToThread = useCallback((windowId: string, threadId: string, projectId?: string | null) => {
    mutateWorkspace(projectId, (windows, activeWindowId) => ({
      windows: windows.map((window) => window.id === windowId
        ? bindWorkspaceWindowThread(window, threadId)
        : window),
      activeWindowId,
    }))
  }, [mutateWorkspace])

  return {
    windows: workspace.windows,
    activeWindowId: workspace.activeWindowId,
    activeRepoId: activeProjectId,
    activeRepoPath: activeWindow && activeExecutionResolution === null
      ? null
      : activeExecutionResolution?.status === 'unavailable'
      ? null
      : activeExecutionContext?.checkoutPath ?? activeProject?.path ?? null,
    activeProjectId,
    activeCheckoutPath: activeExecutionContext?.checkoutPath ?? null,
    activeExecutionContext,
    activeExecutionResolution,
    openChat,
    openTerminal,
    openBrowser,
    updateBrowserState,
    closeWindow,
    closeSessionWindows,
    setActiveWindow,
    renameWindow,
    bindWindowToTask,
    bindWindowToThread,
  }
}
