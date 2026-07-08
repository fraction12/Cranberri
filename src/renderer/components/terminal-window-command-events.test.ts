import { describe, expect, it } from 'vitest'
import { TERMINAL_WINDOW_COMMAND_EVENT, createTerminalWindowCommandEvent, terminalWindowCommandFromEvent } from './terminal-window-command-events'

describe('terminal window command events', () => {
  it('creates terminal window command events', () => {
    const event = createTerminalWindowCommandEvent('term-1', 'search')

    expect(event.type).toBe(TERMINAL_WINDOW_COMMAND_EVENT)
    expect(terminalWindowCommandFromEvent(event)).toEqual({ windowId: 'term-1', command: 'search' })
  })

  it('parses terminal search navigation commands', () => {
    expect(terminalWindowCommandFromEvent(createTerminalWindowCommandEvent('term-1', 'search-next'))).toEqual({ windowId: 'term-1', command: 'search-next' })
    expect(terminalWindowCommandFromEvent(createTerminalWindowCommandEvent('term-1', 'search-previous'))).toEqual({ windowId: 'term-1', command: 'search-previous' })
    expect(terminalWindowCommandFromEvent(createTerminalWindowCommandEvent('term-1', 'search-close'))).toEqual({ windowId: 'term-1', command: 'search-close' })
  })

  it('parses terminal native buffer commands', () => {
    expect(terminalWindowCommandFromEvent(createTerminalWindowCommandEvent('term-1', 'copy-buffer'))).toEqual({ windowId: 'term-1', command: 'copy-buffer' })
    expect(terminalWindowCommandFromEvent(createTerminalWindowCommandEvent('term-1', 'clear'))).toEqual({ windowId: 'term-1', command: 'clear' })
  })

  it('ignores malformed terminal command events', () => {
    expect(terminalWindowCommandFromEvent(new CustomEvent(TERMINAL_WINDOW_COMMAND_EVENT, { detail: { windowId: 'term-1', command: 'copy' } }))).toBeNull()
    expect(terminalWindowCommandFromEvent(new CustomEvent(TERMINAL_WINDOW_COMMAND_EVENT, { detail: { command: 'copy-buffer' } }))).toBeNull()
  })
})
