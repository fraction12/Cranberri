import { describe, expect, it } from 'vitest'
import type { WorkspaceWindowState } from '../../shared/appState'
import { bindWorkspaceWindowThread, chatWindowForExecutionContext, closeSessionChatWindows, codexThreadIdForActiveWindow, createBoundWorkspaceWindow, executionContextForNewToolWindow, localProjectExecutionContext, rebindWorkspaceWindowExecutionContext, renameWorkspaceWindow, repairStaleLocalWorkspaceBindings } from './workspace-model'

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
    { id: 'chat-1', type: 'chat', title: 'Chat', threadId: 'persisted-thread' },
    { id: 'terminal-1', type: 'terminal', title: 'Terminal' },
    { id: 'browser-1', type: 'browser', title: 'Browser', browser: { url: 'about:blank', profileId: 'default' } },
  ]

  it('reads the persisted chat binding and ignores any unrelated global thread', () => {
    expect(codexThreadIdForActiveWindow(windows, 'chat-1')).toBe('persisted-thread')
    expect(codexThreadIdForActiveWindow(windows, 'terminal-1')).toBeNull()
    expect(codexThreadIdForActiveWindow(windows, 'browser-1')).toBeNull()
    expect(codexThreadIdForActiveWindow(windows, null)).toBeNull()
  })

  it('keeps a task thread projected while its terminal is active', () => {
    const boundWindows: WorkspaceWindowState[] = [
      { id: 'chat', type: 'chat', title: 'Chat', taskId: 'task', checkoutId: 'worktree', threadId: 'thread' },
      { id: 'terminal', type: 'terminal', title: 'Terminal', taskId: 'task', checkoutId: 'worktree' },
    ]
    expect(codexThreadIdForActiveWindow(boundWindows, 'terminal', [{ id: 'task', threadId: 'thread' }])).toBe('thread')
  })
})

describe('chatWindowForExecutionContext', () => {
  it('prefers the chat belonging to the active tool task', () => {
    const windows: WorkspaceWindowState[] = [
      { id: 'local-chat', type: 'chat', title: 'Local', projectId: 'project', taskId: 'local', checkoutId: 'local' },
      { id: 'worktree-chat', type: 'chat', title: 'Worktree', projectId: 'project', taskId: 'worktree-task', checkoutId: 'worktree' },
      { id: 'terminal', type: 'terminal', title: 'Terminal', projectId: 'project', taskId: 'worktree-task', checkoutId: 'worktree' },
    ]
    expect(chatWindowForExecutionContext(windows, 'terminal')?.id).toBe('worktree-chat')
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
    expect(window.bindingRevision).toBe(0)
  })

  it('keeps the requested Worktree target while a draft still uses Local context', () => {
    const window = createBoundWorkspaceWindow(
      { id: 'draft', type: 'chat', title: 'New worktree session', sessionTarget: 'worktree' },
      {
        projectId: 'project', taskId: null, checkoutId: 'local', worktreeId: null,
        checkoutPath: '/repo', sessionTarget: 'local',
      },
    )

    expect(window.sessionTarget).toBe('worktree')
  })

  it('persists a thread binding and increments the window revision on every rebind', () => {
    const created = createBoundWorkspaceWindow(
      { id: 'chat', type: 'chat', title: 'Chat' },
      {
        projectId: 'project',
        taskId: null,
        checkoutId: 'checkout',
        worktreeId: null,
        checkoutPath: '/repo',
      },
    )

    const first = bindWorkspaceWindowThread(created, 'thread-1')
    const rebound = bindWorkspaceWindowThread(first, 'thread-2')

    expect(first).toMatchObject({ threadId: 'thread-1', bindingRevision: 1 })
    expect(rebound).toMatchObject({ threadId: 'thread-2', bindingRevision: 2 })
  })

  it('updates the durable session target when a task changes execution location', () => {
    const rebound = rebindWorkspaceWindowExecutionContext(
      { id: 'chat', type: 'chat', title: 'Chat', sessionTarget: 'worktree', bindingRevision: 2 },
      {
        projectId: 'project', taskId: 'task', checkoutId: 'local', worktreeId: 'worktree',
        checkoutPath: '/repo', sessionTarget: 'local',
      },
    )

    expect(rebound).toMatchObject({ checkoutId: 'local', sessionTarget: 'local', bindingRevision: 3 })
  })

  it('creates an unbound local context for a new session', () => {
    expect(localProjectExecutionContext({ id: 'project', path: '/repo', localCheckoutId: 'local' })).toEqual({
      projectId: 'project',
      taskId: null,
      checkoutId: 'local',
      worktreeId: null,
      checkoutPath: '/repo',
      sessionTarget: 'local',
    })
  })

  it('uses the active window checkout for new terminal and browser tools', () => {
    const local = localProjectExecutionContext({ id: 'project', path: '/repo', localCheckoutId: 'local' })
    const active = {
      projectId: 'project',
      taskId: 'task',
      checkoutId: 'worktree',
      worktreeId: 'worktree',
      checkoutPath: '/worktrees/task',
    }

    expect(executionContextForNewToolWindow(undefined, active, local)).toBe(active)
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
        { id: 'restored-chat', type: 'chat' as const, title: 'Restored chat', threadId: 'thread-1' },
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
