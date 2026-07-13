import { describe, expect, it } from 'vitest'
import type { CodexMessage } from '@/shared/codex'
import {
  composerHistoryAutosaveValue,
  composerHistoryDirectionForKey,
  composerHistoryFlushValue,
  createComposerHistory,
  deriveSubmittedPromptHistory,
  isComposerHistoryPreview,
  navigateComposerHistoryDown,
  navigateComposerHistoryUp,
  resetComposerHistory,
} from './composer-history'

function message(
  id: string,
  role: CodexMessage['role'],
  content: string,
  timestamp: number,
  pending = false,
): CodexMessage {
  return { id, role, content, timestamp, pending }
}

describe('composer prompt history', () => {
  it('returns no prompts for an empty transcript', () => {
    expect(deriveSubmittedPromptHistory([])).toEqual([])
  })

  it('derives submitted user prompts in chronological order without mutating messages', () => {
    const messages = Object.freeze([
      Object.freeze(message('later', 'user', 'second', 20)),
      Object.freeze(message('earlier', 'user', 'first', 10)),
    ])

    expect(deriveSubmittedPromptHistory(messages)).toEqual(['first', 'second'])
    expect(messages.map(({ id }) => id)).toEqual(['later', 'earlier'])
  })

  it('ignores pending, empty, and non-user messages', () => {
    const messages = [
      message('assistant', 'assistant', 'response', 1),
      message('pending', 'user', 'not submitted', 2, true),
      message('empty', 'user', '', 3),
      message('whitespace', 'user', '  \n ', 4),
      message('submitted', 'user', 'keep surrounding whitespace ', 5),
    ]

    expect(deriveSubmittedPromptHistory(messages)).toEqual(['keep surrounding whitespace '])
  })

  it('deduplicates only adjacent identical submitted prompts', () => {
    const messages = [
      message('one-a', 'user', 'one', 1),
      message('assistant', 'assistant', 'between submissions', 2),
      message('one-b', 'user', 'one', 3),
      message('two', 'user', 'two', 4),
      message('one-c', 'user', 'one', 5),
    ]

    expect(deriveSubmittedPromptHistory(messages)).toEqual(['one', 'two', 'one'])
  })

  it('navigates previous prompts with first-entry limits', () => {
    const unsent = { text: 'draft' }
    const initial = createComposerHistory<typeof unsent>(['first', 'second'])

    const second = navigateComposerHistoryUp(initial, unsent)
    const first = navigateComposerHistoryUp(second.state, { text: 'ignored replacement' })
    const limited = navigateComposerHistoryUp(first.state, { text: 'also ignored' })

    expect(second.target).toEqual({ kind: 'prompt', prompt: 'second' })
    expect(first.target).toEqual({ kind: 'prompt', prompt: 'first' })
    expect(limited).toEqual({ state: first.state, target: null })
  })

  it('navigates next prompts and restores the exact unsent snapshot at newest', () => {
    const unsent = {
      text: 'draft',
      mentions: [{ id: 'skill:plan', path: '/skills/plan/SKILL.md' }],
      attachments: [{ id: 'attachment-1', path: '/tmp/context.txt' }],
      modes: { plan: true, goal: false },
    }
    const initial = createComposerHistory<typeof unsent>(['first', 'second'])
    const second = navigateComposerHistoryUp(initial, unsent)
    const first = navigateComposerHistoryUp(second.state, unsent)

    const backToSecond = navigateComposerHistoryDown(first.state)
    const backToUnsent = navigateComposerHistoryDown(backToSecond.state)
    const limited = navigateComposerHistoryDown(backToUnsent.state)

    expect(backToSecond.target).toEqual({ kind: 'prompt', prompt: 'second' })
    expect(backToUnsent.target).toEqual({ kind: 'snapshot', snapshot: unsent })
    expect(backToUnsent.target?.kind === 'snapshot' && backToUnsent.target.snapshot).toBe(unsent)
    expect(limited).toEqual({ state: backToUnsent.state, target: null })
  })

  it('does not move or capture a snapshot when history is empty', () => {
    const initial = createComposerHistory<{ text: string }>([])

    expect(navigateComposerHistoryUp(initial, { text: 'draft' })).toEqual({ state: initial, target: null })
    expect(navigateComposerHistoryDown(initial)).toEqual({ state: initial, target: null })
  })

  it('treats prompt collections and structured snapshots as immutable values', () => {
    const prompts = Object.freeze(['first', 'second'])
    const replacementPrompts = Object.freeze(['newest submission'])
    const snapshot = Object.freeze({
      text: 'draft',
      mentions: Object.freeze([Object.freeze({ id: 'skill:plan' })]),
      attachments: Object.freeze([Object.freeze({ id: 'attachment-1' })]),
    })
    const initial = createComposerHistory<typeof snapshot>(prompts)
    const previous = navigateComposerHistoryUp(initial, snapshot)
    const restored = navigateComposerHistoryDown(previous.state)
    const reset = resetComposerHistory(previous.state, replacementPrompts)

    expect(initial.prompts).not.toBe(prompts)
    expect(initial.prompts).toEqual(prompts)
    expect(initial.unsentSnapshot).toEqual({ captured: false })
    expect(previous.state.unsentSnapshot).toEqual({ captured: true, value: snapshot })
    expect(restored.target).toEqual({ kind: 'snapshot', snapshot })
    expect(reset).toEqual(createComposerHistory<typeof snapshot>(replacementPrompts))
    expect(previous.state.cursor).toBe(1)
    expect(prompts).toEqual(['first', 'second'])
    expect(replacementPrompts).toEqual(['newest submission'])
  })

  it('only navigates at document boundaries and yields to open suggestions', () => {
    expect(composerHistoryDirectionForKey({
      key: 'ArrowUp',
      suggestionsOpen: false,
      atDocumentStart: true,
      atDocumentEnd: false,
    })).toBe('previous')
    expect(composerHistoryDirectionForKey({
      key: 'ArrowDown',
      suggestionsOpen: false,
      atDocumentStart: false,
      atDocumentEnd: true,
    })).toBe('next')
    expect(composerHistoryDirectionForKey({
      key: 'ArrowUp',
      suggestionsOpen: false,
      atDocumentStart: false,
      atDocumentEnd: false,
    })).toBeNull()
    expect(composerHistoryDirectionForKey({
      key: 'ArrowDown',
      suggestionsOpen: true,
      atDocumentStart: true,
      atDocumentEnd: true,
    })).toBeNull()
  })

  it('keeps recalled prompts ephemeral while flushes preserve the original pending draft', () => {
    type Draft = {
      text: string
      mentions: Array<{ id: string }>
      pendingSend?: { id: string; startedAt: number }
    }
    const pendingDraft: Draft = {
      text: 'unsent structured draft',
      mentions: [{ id: 'skill:plan' }],
      pendingSend: { id: 'pending-send-1', startedAt: 42 },
    }
    const recalledDraft: Draft = { text: 'submitted prompt', mentions: [] }
    const initial = createComposerHistory<Draft>(['submitted prompt'])
    const preview = navigateComposerHistoryUp(initial, pendingDraft).state

    expect(isComposerHistoryPreview(preview)).toBe(true)
    expect(composerHistoryAutosaveValue(preview, recalledDraft)).toBeNull()
    expect(composerHistoryFlushValue(preview, recalledDraft, pendingDraft)).toBe(pendingDraft)

    const restored = navigateComposerHistoryDown(preview).state
    expect(isComposerHistoryPreview(restored)).toBe(false)
    expect(composerHistoryAutosaveValue(restored, pendingDraft)).toBe(pendingDraft)
    expect(composerHistoryFlushValue(restored, pendingDraft, null)).toBe(pendingDraft)
  })
})
