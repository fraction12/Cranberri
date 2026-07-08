import { describe, expect, it } from 'vitest'
import { terminalBufferChatContext } from './terminal-chat-context'

describe('terminal chat context', () => {
  it('formats terminal output as bounded chat context', () => {
    const context = terminalBufferChatContext({
      terminalId: 'terminal-win-1',
      repoPath: '/repo/project',
      text: 'npm test\nall green',
    })

    expect(context).toContain('Terminal context:')
    expect(context).toContain('Terminal: terminal-win-1')
    expect(context).toContain('Repo: /repo/project')
    expect(context).toContain('all green')
  })

  it('keeps the newest terminal output when truncating', () => {
    const context = terminalBufferChatContext({
      terminalId: 'terminal-win-1',
      repoPath: null,
      text: `${'x'.repeat(13000)}\nlatest-line`,
    })

    expect(context).toContain('latest-line')
    expect(context).toContain('Terminal context truncated')
  })
})
