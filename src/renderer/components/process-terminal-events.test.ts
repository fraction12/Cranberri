import { describe, expect, it } from 'vitest'
import {
  CLOSE_PROCESS_TERMINAL_EVENT,
  OPEN_PROCESS_TERMINAL_EVENT,
  closeableTerminalWorkspaceWindowId,
  closeableTerminalWorkspaceWindowIdFromEvent,
  createCloseProcessTerminalEvent,
  createOpenProcessTerminalEvent,
  openableTerminalWorkspaceWindowId,
  openableTerminalWorkspaceWindowIdFromEvent,
} from './process-terminal-events'
import type { AgentProcessInfo } from '@/shared/processes'

const TERMINAL_PROCESS: AgentProcessInfo = {
  id: 'terminal:terminal-win-1',
  pid: 1234,
  command: 'Cranberri terminal',
  repoPath: '/repo',
  kind: 'terminal',
  source: 'terminal',
  status: 'running',
  startedAt: 1,
  terminalWindowId: 'terminal-win-1',
}

describe('process terminal events', () => {
  it('maps terminal process rows to their workspace tab id', () => {
    expect(closeableTerminalWorkspaceWindowId(TERMINAL_PROCESS)).toBe('win-1')
    expect(closeableTerminalWorkspaceWindowId({ ...TERMINAL_PROCESS, kind: 'agent' })).toBeNull()
    expect(closeableTerminalWorkspaceWindowId({ ...TERMINAL_PROCESS, terminalWindowId: undefined })).toBeNull()
  })

  it('opens child process rows in their owning workspace tab', () => {
    expect(openableTerminalWorkspaceWindowId({ ...TERMINAL_PROCESS, kind: 'agent' })).toBe('win-1')
    expect(openableTerminalWorkspaceWindowId({ ...TERMINAL_PROCESS, terminalWindowId: undefined })).toBeNull()
  })

  it('creates a close event Workspace can resolve', () => {
    const event = createCloseProcessTerminalEvent(TERMINAL_PROCESS)

    expect(event.type).toBe(CLOSE_PROCESS_TERMINAL_EVENT)
    expect(closeableTerminalWorkspaceWindowIdFromEvent(event)).toBe('win-1')
  })

  it('creates an open event Workspace can resolve', () => {
    const event = createOpenProcessTerminalEvent(TERMINAL_PROCESS)

    expect(event.type).toBe(OPEN_PROCESS_TERMINAL_EVENT)
    expect(openableTerminalWorkspaceWindowIdFromEvent(event)).toBe('win-1')
  })
})
