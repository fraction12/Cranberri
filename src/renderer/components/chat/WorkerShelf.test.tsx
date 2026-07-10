import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CodexThread } from '@/shared/codex'
import { WorkerShelf, workerDisplayName, workerStatusLabel } from './WorkerShelf'

const thread: CodexThread = {
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

describe('WorkerShelf', () => {
  it('renders a compact truthful worker chip with accessible detail disclosure', () => {
    const html = renderToStaticMarkup(
      <WorkerShelf
        thread={thread}
        onOpenWorker={vi.fn()}
        onOpenParent={vi.fn()}
        onMessageWorker={vi.fn()}
        onStopWorker={vi.fn()}
      />,
    )

    expect(html).toContain('data-worker-shelf="true"')
    expect(html).toContain('data-worker-status="running"')
    expect(html).toContain('Euclid')
    expect(html).toContain('aria-label="View Euclid"')
    expect(html).not.toContain('max-h-56')
  })

  it('uses literal status labels and a stable fallback name', () => {
    expect(workerStatusLabel('notFound')).toBe('Unavailable')
    expect(workerDisplayName({
      threadId: '12345678-abcd',
      parentThreadId: 'parent-1',
      status: 'completed',
      updatedAt: 10,
    })).toBe('Worker 12345678')
  })
})
