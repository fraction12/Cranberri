import { describe, expect, it } from 'vitest'
import { activeThreadExportFileName, activeThreadMarkdownExport } from './transcript-export'

describe('transcript export', () => {
  it('formats active Codex threads as readable Markdown', () => {
    const markdown = activeThreadMarkdownExport({
      id: 'thread-1',
      title: 'Fix Settings & Palette',
      repoId: 'repo-1',
      messages: [
        { id: 'message-user', role: 'user', content: 'Can you inspect this?', timestamp: Date.parse('2026-07-08T14:00:00.000Z') },
        { id: 'message-assistant', role: 'assistant', content: 'Yes.\n::git-stage{cwd="/tmp"}', timestamp: Date.parse('2026-07-08T14:01:00.000Z') },
        { id: 'message-empty', role: 'tool', content: '   ', timestamp: Date.parse('2026-07-08T14:02:00.000Z') },
      ],
      pendingApprovals: [],
      isRunning: false,
      contextUsage: { usedTokens: 128, contextWindow: 258400 },
    }, '/repo/cranberri', new Date('2026-07-08T15:00:00.000Z'))

    expect(markdown).toContain('# Fix Settings & Palette')
    expect(markdown).toContain('- Thread: thread-1')
    expect(markdown).toContain('- Repo: /repo/cranberri')
    expect(markdown).toContain('- Context: 128 / 258400 tokens')
    expect(markdown).toContain('### User - 2026-07-08T14:00:00.000Z')
    expect(markdown).toContain('Can you inspect this?')
    expect(markdown).toContain('### Assistant - 2026-07-08T14:01:00.000Z')
    expect(markdown).toContain('Yes.')
    expect(markdown).not.toContain('::git-stage')
    expect(markdown).not.toContain('message-empty')
  })

  it('creates safe Markdown filenames from chat titles', () => {
    expect(activeThreadExportFileName({
      id: 'thread-1',
      title: 'Fix Settings & Palette!!!',
      repoId: 'repo-1',
      messages: [],
      pendingApprovals: [],
      isRunning: false,
    })).toBe('fix-settings-palette.md')
  })
})
