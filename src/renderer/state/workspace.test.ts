import { describe, expect, it } from 'vitest'
import type { WorkspaceWindowState } from '../../shared/appState'
import { renameWorkspaceWindow } from './workspace-model'

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
