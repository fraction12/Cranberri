export const TERMINAL_WINDOW_COMMAND_EVENT = 'cranberri:terminal-window-command'

export type TerminalWindowCommand = 'search' | 'search-next' | 'search-previous' | 'search-close' | 'copy-buffer' | 'clear'

const TERMINAL_WINDOW_COMMANDS = new Set<TerminalWindowCommand>(['search', 'search-next', 'search-previous', 'search-close', 'copy-buffer', 'clear'])

interface TerminalWindowCommandEventDetail {
  windowId: string
  command: TerminalWindowCommand
}

export function createTerminalWindowCommandEvent(windowId: string, command: TerminalWindowCommand): CustomEvent<TerminalWindowCommandEventDetail> {
  return new CustomEvent(TERMINAL_WINDOW_COMMAND_EVENT, { detail: { windowId, command } })
}

export function terminalWindowCommandFromEvent(event: Event): TerminalWindowCommandEventDetail | null {
  const detail = (event as CustomEvent<Partial<TerminalWindowCommandEventDetail>>).detail
  if (!detail?.windowId) return null
  const command = detail.command
  if (!TERMINAL_WINDOW_COMMANDS.has(command as TerminalWindowCommand)) return null
  return { windowId: detail.windowId, command: command as TerminalWindowCommand }
}
