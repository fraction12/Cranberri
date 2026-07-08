import { describe, expect, it } from 'vitest'
import { processChatContext } from './process-chat-context'
import type { AgentProcessInfo } from '@/shared/processes'

const PROCESS: AgentProcessInfo = {
  id: 'child:123',
  pid: 123,
  ppid: 99,
  command: 'npm run dev',
  cwd: '/repo/cranberri',
  terminalWindowId: 'terminal-win-1',
  repoPath: '/repo/cranberri',
  kind: 'dev-server',
  source: 'terminal',
  status: 'running',
  startedAt: Date.UTC(2026, 6, 8, 1, 2, 3),
}

describe('process chat context', () => {
  it('formats running process metadata for chat', () => {
    const context = processChatContext(PROCESS)

    expect(context).toContain('Repo process context:')
    expect(context).toContain('Process: npm run dev')
    expect(context).toContain('Kind: dev-server')
    expect(context).toContain('PID: 123')
    expect(context).toContain('Parent PID: 99')
    expect(context).toContain('Terminal window: terminal-win-1')
    expect(context).toContain('Started: 2026-07-08T01:02:03.000Z')
  })

  it('handles process records without a pid or cwd', () => {
    const context = processChatContext({
      ...PROCESS,
      pid: null,
      ppid: undefined,
      cwd: undefined,
      terminalWindowId: undefined,
      status: 'unknown',
      endedAt: Date.UTC(2026, 6, 8, 1, 3, 4),
      signal: 'SIGTERM',
    })

    expect(context).toContain('PID: unknown')
    expect(context).toContain('Status: unknown')
    expect(context).toContain('Ended: 2026-07-08T01:03:04.000Z')
    expect(context).toContain('Signal: SIGTERM')
    expect(context).not.toContain('CWD:')
  })
})
