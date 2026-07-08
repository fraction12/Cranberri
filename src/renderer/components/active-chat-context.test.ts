import { describe, expect, it } from 'vitest'
import { activeChatContext } from './active-chat-context'
import type { CodexThread } from '@/shared/codex'

function thread(overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: 'thread-1',
    title: 'Smoke Codex Thread',
    repoId: 'repo-1',
    messages: [
      { id: 'm1', role: 'user', content: 'Please inspect the app.', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'I inspected the app.', timestamp: 2 },
    ],
    pendingApprovals: [],
    isRunning: false,
    currentActivity: undefined,
    lastRunDurationMs: 1532,
    contextUsage: { usedTokens: 128, contextWindow: 258400 },
    ...overrides,
  }
}

describe('activeChatContext', () => {
  it('formats active thread status, context usage, and recent messages', () => {
    const context = activeChatContext(thread())

    expect(context).toContain('Active chat context:')
    expect(context).toContain('- Title: Smoke Codex Thread')
    expect(context).toContain('- Running: false')
    expect(context).toContain('- Last run duration: 1.5s')
    expect(context).toContain('- Context usage: 128 / 258,400 tokens')
    expect(context).toContain('- user:')
    expect(context).toContain('Please inspect the app.')
  })

  it('includes pending approvals', () => {
    const context = activeChatContext(thread({
      pendingApprovals: [{
        id: 'approval-1',
        reviewId: 'review-1',
        action: { cmd: 'npm install' },
        review: { status: 'pending' },
        description: 'Install dependency',
      }],
    }))

    expect(context).toContain('- Pending approvals: 1')
    expect(context).toContain('- Install dependency')
  })

  it('bounds long active chat transcripts while keeping the latest messages', () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${'x'.repeat(1600)} latest-active-chat-detail-${index}`,
      timestamp: index,
    }))

    const context = activeChatContext(thread({ messages }))

    expect(context).toContain('Active chat context:')
    expect(context).toContain('earlier messages omitted')
    expect(context).toContain('latest-active-chat-detail-39')
    expect(context.length).toBeLessThanOrEqual(12000)
  })
})
