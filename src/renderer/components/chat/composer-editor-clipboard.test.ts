import { describe, expect, it } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import {
  COMPOSER_CLIPBOARD_MIME,
  composerClipboardPayload,
  composerStateFromText,
  parseComposerClipboardPayload,
  replaceComposerSelectionWithClipboard,
  type ComposerMention,
} from './composer-editor-model'

const SKILL: ComposerMention = {
  kind: 'skill',
  id: 'ce-work',
  name: 'compound-engineering:ce-work',
  displayName: 'Ce Work',
  path: '/skills/ce-work/SKILL.md',
  description: 'Execute a plan',
}

describe('composer clipboard payload', () => {
  it('preserves atomic mentions and both prompt and plain-text forms', () => {
    const initial = composerStateFromText(`Run [$compound-engineering:ce-work](${SKILL.path}) now`, [SKILL])
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 1, initial.doc.content.size - 1)))

    expect(COMPOSER_CLIPBOARD_MIME).toBe('application/x-cranberri-composer+json')
    expect(composerClipboardPayload(state)).toEqual({
      version: 1,
      text: `Run [$compound-engineering:ce-work](${SKILL.path}) now`,
      plainText: 'Run Ce Work now',
      mentions: [expect.objectContaining({ kind: 'skill', path: SKILL.path })],
    })
  })

  it('serializes multiline selections without flattening their structure', () => {
    const initial = composerStateFromText('first line\nsecond line')
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 1, initial.doc.content.size - 1)))

    expect(composerClipboardPayload(state)).toMatchObject({
      text: 'first line\nsecond line',
      plainText: 'first line\nsecond line',
    })
  })

  it('returns no structured payload for an empty selection', () => {
    expect(composerClipboardPayload(composerStateFromText('draft'))).toBeNull()
  })

  it('parses only complete versioned payloads', () => {
    const payload = {
      version: 1,
      text: `[$compound-engineering:ce-work](${SKILL.path})`,
      plainText: 'Ce Work',
      mentions: [SKILL],
    }

    expect(parseComposerClipboardPayload(JSON.stringify(payload))).toEqual(payload)
    expect(parseComposerClipboardPayload('{not-json')).toBeNull()
    expect(parseComposerClipboardPayload(JSON.stringify({ ...payload, version: 2 }))).toBeNull()
    expect(parseComposerClipboardPayload(JSON.stringify({ ...payload, mentions: [{ kind: 'skill' }] }))).toBeNull()
  })

  it('restores structured mentions into the live selection', () => {
    const initial = composerStateFromText('Run  please')
    const selected = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 5, 5)))
    const payload = {
      version: 1 as const,
      text: `[$compound-engineering:ce-work](${SKILL.path})`,
      plainText: 'Ce Work',
      mentions: [SKILL],
    }

    const next = replaceComposerSelectionWithClipboard(selected, payload)

    expect(next.doc.firstChild?.child(1).type.name).toBe('skillMention')
    expect(composerClipboardPayload(next.apply(next.tr.setSelection(TextSelection.create(next.doc, 5, 6))))).toMatchObject({
      mentions: [expect.objectContaining({ path: SKILL.path })],
    })
  })
})
