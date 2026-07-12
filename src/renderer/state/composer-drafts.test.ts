import { describe, expect, it } from 'vitest'
import type { ComposerDraft } from '@/shared/composer-drafts'
import {
  composerDraftHasContent,
  composerDraftOwnerKey,
  journalComposerDraftSend,
  legacyComposerDraftOwnerKey,
  sameComposerDraftPayload,
} from './composer-drafts'

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    ownerKey: 'project/window:one',
    projectId: 'project',
    windowId: 'one',
    bindingRevision: 0,
    updatedAt: 1,
    text: '',
    mentions: [],
    attachmentPaths: [],
    contextInputAttachments: [],
    turnSettings: { model: 'gpt-5.6-sol', effort: 'medium', speed: 'standard', approvalMode: 'custom' },
    planMode: false,
    goalMode: false,
    baseRef: 'HEAD',
    environmentId: null,
    includeLocalChanges: false,
    ...overrides,
  }
}

describe('composer draft state', () => {
  it('keeps draft ownership stable when the first thread is created', () => {
    expect(composerDraftOwnerKey('project one', 'window one')).toBe('project%20one/window%3Awindow%20one')
    expect(composerDraftOwnerKey('project one', 'window one', 'thread one')).toBe('project%20one/window%3Awindow%20one')
    expect(legacyComposerDraftOwnerKey('project one', 'thread one')).toBe('project%20one/thread%3Athread%20one')
  })

  it('treats structured context and modes as durable content', () => {
    expect(composerDraftHasContent(draft())).toBe(false)
    expect(composerDraftHasContent(draft({ planMode: true }))).toBe(true)
    expect(composerDraftHasContent(draft({ attachmentPaths: ['/tmp/context.txt'] }))).toBe(true)
  })

  it('journals a send without removing its recoverable content', () => {
    const current = draft({ text: 'Keep this until acknowledged' })
    const journaled = journalComposerDraftSend(current, { id: '019f-draft-send', startedAt: 42, threadId: 'thread-1' })

    expect(journaled).toMatchObject({
      text: current.text,
      updatedAt: 42,
      pendingSend: { id: '019f-draft-send', startedAt: 42, threadId: 'thread-1' },
    })
  })

  it('reuses the durable key when an interrupted send is retried', () => {
    const interrupted = draft({
      text: 'Deliver exactly once',
      pendingSend: { id: '019f-draft-send', startedAt: 42 },
    })

    expect(journalComposerDraftSend(interrupted, { startedAt: 99, threadId: 'thread-1' }).pendingSend).toEqual({
      id: '019f-draft-send',
      startedAt: 42,
      threadId: 'thread-1',
    })
  })

  it('distinguishes an exact retry from edited message content', () => {
    const original = draft({ text: 'Deliver exactly once' })
    expect(sameComposerDraftPayload(original, { ...original, updatedAt: 99 })).toBe(true)
    expect(sameComposerDraftPayload(original, { ...original, text: 'Deliver the edited message' })).toBe(false)
    const interrupted = { ...original, pendingSend: { id: 'old-key', startedAt: 42 } }
    expect(journalComposerDraftSend(interrupted, { id: 'new-key', reusePending: false }).pendingSend?.id).toBe('new-key')
  })
})
