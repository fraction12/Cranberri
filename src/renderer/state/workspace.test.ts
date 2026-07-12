import { describe, expect, it } from 'vitest'
import type { WorkspaceWindowState } from '../../shared/appState'
import { closeSessionChatWindows, codexThreadIdForActiveWindow, createBoundWorkspaceWindow, localProjectExecutionContext, renameWorkspaceWindow, repairStaleLocalWorkspaceBindings } from './workspace-model'

describe('renameWorkspaceWindow', () => {
  const chat: WorkspaceWindowState = { id: 'chat-1', type: 'chat', title: 'Existing title' }
  const terminal: WorkspaceWindowState = { id: 'terminal-1', type: 'terminal', title: 'Terminal 1' }

  it('returns the existing window list when the title is already synchronized', () => {
    const windows = [chat, terminal]

    expect(renameWorkspaceWindow(windows, chat.id, chat.title)).toBe(windows)
  })

  it('only replaces the renamed window when the title changes', () => {
    const windows = [chat, terminal]
    const renamed = renameWorkspaceWindow(windows, chat.id, 'New title')

    expect(renamed).not.toBe(windows)
    expect(renamed[0]).toEqual({ ...chat, title: 'New title' })
    expect(renamed[1]).toBe(terminal)
  })

  it('returns the existing window list when the target does not exist', () => {
    const windows = [chat, terminal]

    expect(renameWorkspaceWindow(windows, 'missing', 'New title')).toBe(windows)
  })
})

describe('codexThreadIdForActiveWindow', () => {
  const windows: WorkspaceWindowState[] = [
    { id: 'chat-1', type: 'chat', title: 'Chat' },
    { id: 'terminal-1', type: 'terminal', title: 'Terminal' },
    { id: 'browser-1', type: 'browser', title: 'Browser', browser: { url: 'about:blank', profileId: 'default' } },
  ]

  it('scopes tool evidence to a thread only while a chat window is active', () => {
    expect(codexThreadIdForActiveWindow(windows, 'chat-1', 'thread-1')).toBe('thread-1')
    expect(codexThreadIdForActiveWindow(windows, 'terminal-1', 'thread-1')).toBeNull()
    expect(codexThreadIdForActiveWindow(windows, 'browser-1', 'thread-1')).toBeNull()
    expect(codexThreadIdForActiveWindow(windows, null, 'thread-1')).toBeNull()
  })
})

describe('workspace execution identity', () => {
  it('permits a nullable task binding while preserving project and checkout identity', () => {
    const window: WorkspaceWindowState = { id: 'draft', type: 'chat', title: 'Draft', projectId: 'project', taskId: null, checkoutId: 'local' }
    expect(window).toMatchObject({ projectId: 'project', taskId: null, checkoutId: 'local' })
  })

  it('captures task and checkout identity when a window opens', () => {
    const window = createBoundWorkspaceWindow(
      { id: 'terminal', type: 'terminal', title: 'Terminal' },
      {
        projectId: 'project',
        taskId: 'task',
        checkoutId: 'checkout',
        worktreeId: 'worktree',
        checkoutPath: '/worktrees/task',
      },
    )
    expect(window).toMatchObject({ projectId: 'project', taskId: 'task', checkoutId: 'checkout' })
  })

  it('creates an unbound local context for a new session', () => {
    expect(localProjectExecutionContext({ id: 'project', path: '/repo', localCheckoutId: 'local' })).toEqual({
      projectId: 'project',
      taskId: null,
      checkoutId: 'local',
      worktreeId: null,
      checkoutPath: '/repo',
    })
  })

  it('repairs deleted Local control bindings without touching managed or valid tasks', () => {
    const workspaces = {
      project: {
        windows: [
          { id: 'control', type: 'chat' as const, title: 'Local control', projectId: 'project', taskId: 'deleted-control', checkoutId: 'local' },
          { id: 'valid', type: 'chat' as const, title: 'Valid session', projectId: 'project', taskId: 'valid-task', checkoutId: 'local' },
          { id: 'managed', type: 'terminal' as const, title: 'Managed terminal', projectId: 'project', taskId: 'deleted-managed', checkoutId: 'managed' },
        ],
        activeWindowId: 'control',
      },
    }

    const repaired = repairStaleLocalWorkspaceBindings(
      workspaces,
      [{ id: 'project', localCheckoutId: 'local' }],
      new Set(['valid-task']),
    )

    expect(repaired.project.windows).toEqual([
      expect.objectContaining({ id: 'control', title: 'New local session', taskId: null, checkoutId: 'local', sessionTarget: 'local' }),
      expect.objectContaining({ id: 'valid', taskId: 'valid-task', checkoutId: 'local' }),
      expect.objectContaining({ id: 'managed', taskId: 'deleted-managed', checkoutId: 'managed' }),
    ])
  })
})

describe('closeSessionChatWindows', () => {
  it('closes every matching chat while preserving related tools and choosing a neighboring tab', () => {
    const workspace = {
      windows: [
        { id: 'before', type: 'browser' as const, title: 'Browser' },
        { id: 'task-chat', type: 'chat' as const, title: 'Task chat', taskId: 'task-1' },
        { id: 'session-thread-1', type: 'chat' as const, title: 'Restored chat' },
        { id: 'task-terminal', type: 'terminal' as const, title: 'Terminal', taskId: 'task-1' },
        { id: 'after', type: 'chat' as const, title: 'Another chat', taskId: 'task-2' },
      ],
      activeWindowId: 'task-chat',
    }

    expect(closeSessionChatWindows(workspace, { threadId: 'thread-1', taskId: 'task-1' })).toEqual({
      windows: [
        workspace.windows[0],
        workspace.windows[3],
        workspace.windows[4],
      ],
      activeWindowId: 'before',
    })
  })

  it('preserves the workspace identity when no session chat matches', () => {
    const workspace = {
      windows: [{ id: 'chat', type: 'chat' as const, title: 'Chat', taskId: 'task-2' }],
      activeWindowId: 'chat',
    }

    expect(closeSessionChatWindows(workspace, { threadId: 'thread-1', taskId: 'task-1' })).toBe(workspace)
  })
})
