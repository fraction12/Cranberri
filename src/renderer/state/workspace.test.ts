import { describe, expect, it } from 'vitest'
import type { WorkspaceWindowState } from '../../shared/appState'
import { codexThreadIdForActiveWindow, renameWorkspaceWindow } from './workspace-model'

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
})
