import { describe, expect, it } from 'vitest'
import { createProcessContextCapturedEvent, PROCESS_CONTEXT_CAPTURED_EVENT, processContextFromEvent } from './process-context-events'
import type { AgentProcessInfo } from '@/shared/processes'

const PROCESS: AgentProcessInfo = {
  id: 'process-1',
  repoPath: '/repo/project',
  cwd: '/repo/project',
  command: 'npm run dev',
  kind: 'dev-server',
  status: 'running',
  source: 'terminal',
  pid: 123,
  ppid: 12,
  startedAt: 1,
}

describe('process context events', () => {
  it('round-trips captured process context', () => {
    const event = createProcessContextCapturedEvent(PROCESS)

    expect(event.type).toBe(PROCESS_CONTEXT_CAPTURED_EVENT)
    expect(processContextFromEvent(event)).toEqual(PROCESS)
  })

  it('ignores non-process events', () => {
    expect(processContextFromEvent(new Event('other'))).toBeNull()
    expect(processContextFromEvent(new CustomEvent(PROCESS_CONTEXT_CAPTURED_EVENT, { detail: { repoPath: '/repo/project' } }))).toBeNull()
  })
})
