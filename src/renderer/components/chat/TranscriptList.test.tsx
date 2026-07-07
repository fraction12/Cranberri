import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TranscriptList } from './TranscriptList'
import type { CodexMessage, CodexThread } from '@/shared/codex'

function message(id: string, role: CodexMessage['role'], content: string, pending?: boolean): CodexMessage {
  return { id, role, content, timestamp: 1, pending }
}

function thread(messages: CodexMessage[], overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: 'thread-1',
    title: 'Thread',
    repoId: 'repo-1',
    messages,
    pendingApprovals: [],
    isRunning: false,
    ...overrides,
  }
}

function renderTranscript(targetThread: CodexThread, expandedGroupIds = new Set<string>()): string {
  return renderToStaticMarkup(
    <TranscriptList
      thread={targetThread}
      skills={[]}
      expandedGroupIds={expandedGroupIds}
      onToggleGroup={() => undefined}
    />,
  )
}

describe('TranscriptList', () => {
  it('groups reasoning and system messages between ordinary transcript messages', () => {
    const html = renderTranscript(
      thread([
        message('user-1', 'user', 'Please inspect this'),
        message('reasoning-1', 'reasoning', 'Looking at the diff'),
        message('system-1', 'system', 'Tool output arrived'),
        message('user-2', 'user', 'Thanks'),
      ]),
      new Set(['reasoning-reasoning-1']),
    )

    expect(html).toContain('Please inspect this')
    expect(html).toContain('Worked')
    expect(html).toContain('Looking at the diff')
    expect(html).toContain('Tool output arrived')
    expect(html).toContain('Thanks')
  })

  it('renders a running working group after the latest user message when no reasoning has arrived yet', () => {
    const html = renderTranscript(
      thread(
        [message('user-1', 'user', 'Start working')],
        { isRunning: true, currentActivity: 'Calling tool', runStartedAt: Date.now() },
      ),
    )

    expect(html).toContain('Start working')
    expect(html).toContain('Calling tool')
  })

  it('renders pending and completed compact divider states', () => {
    const html = renderTranscript(
      thread([
        message('compact-1', 'compact', 'Compacting context', true),
        message('compact-2', 'compact', 'Context compacted'),
      ]),
    )

    expect(html).toContain('Compacting')
    expect(html).toContain('compacted')
  })
})
