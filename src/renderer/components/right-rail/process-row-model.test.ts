import { describe, expect, it } from 'vitest'
import { canFocusProcessTerminal, processRowMetadata, processRuntimeLabel } from './process-row-model'
import type { AgentProcessInfo } from '@/shared/processes'

const PROCESS: AgentProcessInfo = {
  id: 'terminal:win-1',
  pid: 1234,
  command: 'Cranberri terminal',
  cwd: '/repo',
  terminalWindowId: 'terminal-win-1',
  repoPath: '/repo',
  kind: 'terminal',
  source: 'terminal',
  status: 'running',
  startedAt: 1_000,
}

describe('process row model', () => {
  it('formats running and completed process runtime labels', () => {
    expect(processRuntimeLabel(PROCESS, 126_000)).toBe('running 2m 5s')
    expect(processRuntimeLabel({ ...PROCESS, status: 'exited', endedAt: 61_000 }, 126_000)).toBe('ran 1m')
  })

  it('builds compact metadata chips for process rows', () => {
    expect(processRowMetadata(PROCESS, 3_000)).toEqual(['running', 'terminal', 'pid 1234', 'running 2s'])
    expect(processRowMetadata({ ...PROCESS, pid: null, source: 'codex' }, 3_000)).toContain('pid unknown')
  })

  it('only focuses processes that have an owning terminal window', () => {
    expect(canFocusProcessTerminal(PROCESS)).toBe(true)
    expect(canFocusProcessTerminal({ ...PROCESS, terminalWindowId: undefined })).toBe(false)
  })
})
