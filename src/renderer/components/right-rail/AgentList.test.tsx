import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CodexThread } from '@/shared/codex'
import { AgentList, agentDisplayName, agentStatusLabel } from './AgentList'

const parentThread: CodexThread = {
  id: 'parent-1',
  title: 'Parent',
  repoId: 'repo-1',
  messages: [],
  pendingApprovals: [],
  isRunning: false,
  workers: [{
    threadId: 'worker-1',
    parentThreadId: 'parent-1',
    nickname: 'Euclid',
    role: 'explorer',
    status: 'running',
    message: 'Inspecting tests',
    updatedAt: 10,
  }],
}

const callbacks = {
  onOpenAgent: vi.fn(),
  onOpenParent: vi.fn(),
  onMessageAgent: vi.fn(),
  onStopAgent: vi.fn(),
}

describe('AgentList', () => {
  it('renders workers as a vertical rail-native agent list', () => {
    const html = renderToStaticMarkup(<AgentList thread={parentThread} {...callbacks} />)

    expect(html).toContain('data-agents-panel="true"')
    expect(html).toContain('data-worker-status="running"')
    expect(html).toContain('Euclid')
    expect(html).toContain('aria-label="View Euclid"')
    expect(html).not.toContain('data-worker-shelf')
  })

  it('keeps parent navigation visible on an opened agent task', () => {
    const html = renderToStaticMarkup(
      <AgentList
        thread={{ ...parentThread, id: 'worker-1', parentThreadId: 'parent-1', agentNickname: 'Euclid', workers: [] }}
        {...callbacks}
      />,
    )

    expect(html).toContain('Current agent')
    expect(html).toContain('aria-label="Open parent task"')
  })

  it('uses literal status labels and a stable fallback name', () => {
    expect(agentStatusLabel('notFound')).toBe('Not found')
    expect(agentDisplayName({
      threadId: '12345678-abcd',
      parentThreadId: 'parent-1',
      status: 'completed',
      updatedAt: 10,
    })).toBe('Agent 12345678')
  })
})
