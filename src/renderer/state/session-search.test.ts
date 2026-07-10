import { describe, expect, it } from 'vitest'
import type { CodexSessionThread } from '@/shared/codex'
import { codexThreadSummary, compactSessionSummary, searchSessionTranscript, sessionChatContext, sessionThreadMatchesSummary } from './session-search'

function thread(overrides: Partial<CodexSessionThread> = {}): CodexSessionThread {
  return {
    id: 'thread-1',
    title: 'Browser smoke work',
    preview: 'Initial repo setup',
    cwd: '/repo/cranberri',
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    turnCount: 2,
    turns: [
      {
        id: 'turn-1',
        startedAt: 1,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'Please inspect the browser smoke marker.' }] },
          { id: 'agent-1', type: 'agentMessage', text: 'I found cranberri-browser-smoke-ready in the page.', phase: 'final_answer' },
        ],
      },
      {
        id: 'turn-2',
        startedAt: 2,
        items: [
          { id: 'reason-1', type: 'reasoning', summary: ['Need to wire transcript context next.'] },
        ],
      },
    ],
    ...overrides,
  }
}

describe('session transcript search', () => {
  it('matches all query terms across transcript items', () => {
    const matches = searchSessionTranscript(thread(), 'browser smoke')

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({
      turnId: 'turn-1',
      itemId: 'user-1',
      role: 'user',
    })
    expect(matches[1].preview).toContain('cranberri-browser-smoke-ready')
    expect(searchSessionTranscript(thread(), 'missing browser')).toEqual([])
  })

  it('matches session summary fields separately from transcript text', () => {
    expect(sessionThreadMatchesSummary(thread(), 'browser work')).toBe(true)
    expect(sessionThreadMatchesSummary(thread(), 'not here')).toBe(false)
  })

  it('derives a session summary from a hydrated thread', () => {
    const summary = codexThreadSummary(thread({ id: 'thread-2', archived: true }))

    expect(summary).toMatchObject({
      id: 'thread-2',
      title: 'Browser smoke work',
      archived: true,
      turnCount: 2,
    })
    expect('turns' in summary).toBe(false)
  })

  it('bounds session previews before they reach command search UI', () => {
    const summary = compactSessionSummary(thread({ preview: `diagnostics ${'x'.repeat(10_000)} tail` }))

    expect(summary.preview?.length).toBeLessThanOrEqual(240)
    expect(summary.preview).toContain('diagnostics')
    expect(summary.preview).toContain('tail')
  })

  it('formats bounded session context with match previews and transcript', () => {
    const matches = searchSessionTranscript(thread(), 'transcript context')
    const context = sessionChatContext(thread(), matches)

    expect(context).toContain('Codex session context:')
    expect(context).toContain('Title: Browser smoke work')
    expect(context).toContain('Transcript matches:')
    expect(context).toContain('reasoning in turn-2')
    expect(context).toContain('Recent transcript:')
    expect(context).toContain('Please inspect the browser smoke marker.')
    expect(context.length).toBeLessThan(14_500)
  })
})
