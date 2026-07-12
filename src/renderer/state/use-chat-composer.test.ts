import { describe, expect, it } from 'vitest'
import { buildChatComposerMessage, runComposerSendLifecycle } from './use-chat-composer'
import type { ComposerMention } from '../components/chat/composer-editor-model'

const SKILL: ComposerMention = {
  kind: 'skill',
  id: 'ce-work',
  name: 'compound-engineering:ce-work',
  displayName: 'Ce Work',
  path: '/skills/ce-work/SKILL.md',
  description: 'Execute a plan',
}

describe('chat composer message assembly', () => {
  it('preserves input ordering and deduplicates selected skills', () => {
    const contextInput = { type: 'text' as const, text: 'Selected diff context' }
    const message = buildChatComposerMessage({
      text: 'Implement the change',
      mentions: [SKILL, SKILL, { kind: 'plugin', id: 'github', name: 'github', displayName: 'GitHub', path: 'plugin://github', description: 'GitHub tools' }],
      attachments: ['/tmp/notes.txt', '/tmp/screenshot.png'],
      contextInputParts: [{ id: 'context-1', label: 'Selected diff', input: contextInput }],
      goalMode: false,
      planMode: true,
    })

    expect(message.displayText).toBe('Implement the change')
    expect(message.input).toEqual([
      { type: 'text', text: 'Plan mode: do not edit files yet. Inspect the repo, produce a concise implementation plan, risks, and verification steps, then wait for approval.' },
      { type: 'text', text: 'Attached local paths:\n- /tmp/notes.txt\n- /tmp/screenshot.png' },
      { type: 'localImage', path: '/tmp/screenshot.png', detail: 'high' },
      contextInput,
      { type: 'text', text: 'Implement the change' },
      { type: 'skill', name: SKILL.name, path: SKILL.path },
    ])
  })

  it('uses attached-context copy and gives goal mode precedence', () => {
    const message = buildChatComposerMessage({
      text: '',
      mentions: [],
      attachments: [],
      contextInputParts: [{ id: 'context-1', label: 'Terminal', input: { type: 'text', text: 'Terminal output' } }],
      goalMode: true,
      planMode: true,
    })

    expect(message.displayText).toBe('Attached context')
    expect(message.input).toEqual([
      { type: 'text', text: 'Create and run this as a Codex goal. Keep working until the goal is complete, and report progress only when you need a decision or finish.' },
      { type: 'text', text: 'Terminal output' },
    ])
  })
})

describe('composer send lifecycle', () => {
  it('journals, clears visible state, dispatches, then clears the acknowledged draft', async () => {
    const events: string[] = []
    const result = await runComposerSendLifecycle({
      journal: async () => { events.push('journal'); return { id: 'pending-send' } },
      clearVisible: () => events.push('clear-visible'),
      dispatch: async (journaled) => { events.push(`dispatch:${journaled?.id}`) },
      restoreVisible: () => events.push('restore-visible'),
      restoreSavedDraft: () => events.push('restore-saved'),
      clearSavedDraft: async () => { events.push('clear-saved') },
    })

    expect(events).toEqual(['journal', 'clear-visible', 'dispatch:pending-send', 'clear-saved'])
    expect(result).toEqual({ acknowledged: true })
  })

  it('restores visible and saved state after dispatch failure without clearing the draft', async () => {
    const events: string[] = []
    const failure = new Error('dispatch failed')
    const result = await runComposerSendLifecycle({
      journal: async () => { events.push('journal'); return { id: 'pending-send' } },
      clearVisible: () => events.push('clear-visible'),
      dispatch: async () => { events.push('dispatch'); throw failure },
      restoreVisible: () => events.push('restore-visible'),
      restoreSavedDraft: () => events.push('restore-saved'),
      clearSavedDraft: async () => { events.push('clear-saved') },
    })

    expect(events).toEqual(['journal', 'clear-visible', 'dispatch', 'restore-visible', 'restore-saved'])
    expect(result).toEqual({ acknowledged: false, dispatchError: failure })
  })

  it('does not clear visible state when journaling fails', async () => {
    const events: string[] = []
    await expect(runComposerSendLifecycle({
      journal: async () => { events.push('journal'); throw new Error('journal failed') },
      clearVisible: () => events.push('clear-visible'),
      dispatch: async () => { events.push('dispatch') },
      restoreVisible: () => events.push('restore-visible'),
      restoreSavedDraft: () => events.push('restore-saved'),
      clearSavedDraft: async () => { events.push('clear-saved') },
    })).rejects.toThrow('journal failed')

    expect(events).toEqual(['journal'])
  })
})
