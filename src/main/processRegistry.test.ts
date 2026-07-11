import { describe, expect, it } from 'vitest'
import type { AgentProcessInfo } from '../shared/processes'
import { filterProcessesForExecution } from './processRegistry'

function processInfo(id: string, taskId: string, checkoutId: string): AgentProcessInfo {
  return {
    id, pid: 123, command: 'npm run dev', repoPath: '/repo', projectId: 'project', taskId, checkoutId,
    kind: 'dev-server', source: 'terminal', status: 'running', startedAt: 1,
  }
}

describe('process execution isolation', () => {
  it('returns only processes owned by the requested task and checkout', () => {
    const processes = [processInfo('a', 'task-a', 'checkout-a'), processInfo('b', 'task-b', 'checkout-b')]
    expect(filterProcessesForExecution(processes, { taskId: 'task-a', checkoutId: 'checkout-a' })).toEqual([processes[0]])
  })
})
