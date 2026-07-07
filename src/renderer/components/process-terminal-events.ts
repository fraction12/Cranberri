import type { AgentProcessInfo } from '@/shared/processes'

export const OPEN_PROCESS_TERMINAL_EVENT = 'cranberri:open-process-terminal'
export const CLOSE_PROCESS_TERMINAL_EVENT = 'cranberri:close-process-terminal'

interface ProcessTerminalEventDetail {
  process: AgentProcessInfo
}

type ProcessWithTerminalWindow = Pick<AgentProcessInfo, 'terminalWindowId'> & Partial<Pick<AgentProcessInfo, 'kind'>>
type TerminalProcessLike = Pick<AgentProcessInfo, 'kind' | 'terminalWindowId'>

function workspaceWindowIdFromTerminalSessionId(terminalWindowId: string | undefined): string | null {
  if (!terminalWindowId) return null
  return terminalWindowId.startsWith('terminal-') ? terminalWindowId.slice('terminal-'.length) : terminalWindowId
}

export function openableTerminalWorkspaceWindowId(processInfo: ProcessWithTerminalWindow | null | undefined): string | null {
  return workspaceWindowIdFromTerminalSessionId(processInfo?.terminalWindowId)
}

export function closeableTerminalWorkspaceWindowId(processInfo: TerminalProcessLike | null | undefined): string | null {
  if (processInfo?.kind !== 'terminal') return null
  return workspaceWindowIdFromTerminalSessionId(processInfo.terminalWindowId)
}

export function createOpenProcessTerminalEvent(processInfo: AgentProcessInfo): CustomEvent<ProcessTerminalEventDetail> {
  return new CustomEvent(OPEN_PROCESS_TERMINAL_EVENT, { detail: { process: processInfo } })
}

export function createCloseProcessTerminalEvent(processInfo: AgentProcessInfo): CustomEvent<ProcessTerminalEventDetail> {
  return new CustomEvent(CLOSE_PROCESS_TERMINAL_EVENT, { detail: { process: processInfo } })
}

export function openableTerminalWorkspaceWindowIdFromEvent(event: Event): string | null {
  const processInfo = (event as CustomEvent<Partial<ProcessTerminalEventDetail>>).detail?.process
  return openableTerminalWorkspaceWindowId(processInfo)
}

export function closeableTerminalWorkspaceWindowIdFromEvent(event: Event): string | null {
  const processInfo = (event as CustomEvent<Partial<ProcessTerminalEventDetail>>).detail?.process
  return closeableTerminalWorkspaceWindowId(processInfo)
}
