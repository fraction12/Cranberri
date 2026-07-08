import { describe, expect, it } from 'vitest'
import { stripTerminalControlSequences, terminalClipboardText } from './terminal-buffer'

describe('terminal buffer clipboard text', () => {
  it('strips common terminal control sequences from PTY snapshots', () => {
    expect(stripTerminalControlSequences('\u001B[32mready\u001B[0m\r\nnext')).toBe('ready\nnext')
  })

  it('prefers durable PTY snapshots when rendered xterm text only has the prompt', () => {
    const text = terminalClipboardText(
      'dushyant@machine repo %',
      '\u001B[32mcranberri-terminal-context-ready\u001B[0m\r\ndushyant@machine repo % ',
    )

    expect(text).toContain('cranberri-terminal-context-ready')
    expect(text).not.toContain('\u001B[32m')
  })

  it('keeps rendered text when it has more useful content than the snapshot', () => {
    expect(terminalClipboardText('visible terminal output', 'short')).toBe('visible terminal output')
  })
})
