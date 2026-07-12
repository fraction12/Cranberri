import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import {
  composerSchema,
  composerSnapshot,
  composerStateFromText,
  composerTrigger,
  insertComposerMention,
  type ComposerMention,
} from './composer-editor-model'

const BRAINSTORM: ComposerMention = {
  kind: 'skill',
  id: 'skill:ce-brainstorm',
  name: 'compound-engineering:ce-brainstorm',
  displayName: 'Ce Brainstorm',
  path: '/skills/ce-brainstorm/SKILL.md',
  description: 'Explore a product direction',
}

const SECOND_BRAINSTORM: ComposerMention = {
  ...BRAINSTORM,
  id: 'skill:other-brainstorm',
  name: 'other:brainstorm',
  path: '/skills/other/SKILL.md',
}

describe('composer editor model', () => {
  it('keeps the real selection after an atomic mention when text follows it', () => {
    let state = composerStateFromText('this is a test $brain d')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 23)))

    const next = insertComposerMention(state, BRAINSTORM, { from: 16, to: 22 })
    const paragraph = next.doc.firstChild

    expect(paragraph?.childCount).toBe(3)
    expect(paragraph?.child(1).type).toBe(composerSchema.nodes.skillMention)
    expect(paragraph?.child(2).text).toBe(' d')
    expect(next.selection.empty).toBe(true)
    expect(next.selection.from).toBe(17)
  })

  it('serializes skill and plugin mentions as native-style prompt links', () => {
    let state = composerStateFromText('Use  then ')
    state = insertComposerMention(state, BRAINSTORM, { from: 5, to: 5 })
    state = insertComposerMention(state, {
      kind: 'plugin',
      id: 'computer-use@openai-bundled',
      name: 'computer-use',
      displayName: 'Computer Use',
      path: 'plugin://computer-use@openai-bundled',
      description: 'Control desktop apps',
    }, { from: 12, to: 12 })

    expect(composerSnapshot(state.doc)).toMatchObject({
      text: 'Use [$compound-engineering:ce-brainstorm](/skills/ce-brainstorm/SKILL.md) then [@computer-use](plugin://computer-use@openai-bundled) ',
      plainText: 'Use Ce Brainstorm then Computer Use ',
      mentions: [expect.objectContaining({ kind: 'skill', id: BRAINSTORM.id }), expect.objectContaining({ kind: 'plugin', id: 'computer-use@openai-bundled' })],
    })
  })

  it('preserves mention identity when display names collide', () => {
    let state = composerStateFromText(' ')
    state = insertComposerMention(state, BRAINSTORM, { from: 1, to: 1 })
    state = insertComposerMention(state, SECOND_BRAINSTORM, { from: 2, to: 2 })

    expect(composerSnapshot(state.doc).mentions.map((mention) => mention.id)).toEqual([
      'skill:ce-brainstorm',
      'skill:other-brainstorm',
    ])
  })

  it('restores the mention with the exact path when canonical names collide', () => {
    const alternate = {
      ...BRAINSTORM,
      id: 'skill:alternate-source',
      path: '/skills/alternate/SKILL.md',
    }
    const state = composerStateFromText(
      '[$compound-engineering:ce-brainstorm](/skills/alternate/SKILL.md)',
      [BRAINSTORM, alternate],
    )

    expect(composerSnapshot(state.doc).mentions).toEqual([expect.objectContaining({ id: alternate.id, path: alternate.path })])
  })

  it('does not retarget a serialized mention when its original path is unavailable', () => {
    const originalPath = '/skills/original/SKILL.md'
    const state = composerStateFromText(
      `[$compound-engineering:ce-brainstorm](${originalPath})`,
      [BRAINSTORM],
    )

    expect(composerSnapshot(state.doc).mentions).toEqual([
      expect.objectContaining({ id: `skill:${originalPath}`, path: originalPath }),
    ])
  })

  it.each([
    ['$brain', '$', 'brain'],
    ['Use @computer', '@', 'computer'],
    ['/compact', '/', 'compact'],
  ] as const)('detects the %s suggestion at the live selection', (text, char, query) => {
    const state = composerStateFromText(text)
    expect(composerTrigger(state)).toMatchObject({ char, query })
  })

  it('does not activate suggestions for a non-collapsed selection', () => {
    const initial = composerStateFromText('$brain')
    const state = EditorState.create({
      schema: composerSchema,
      doc: initial.doc,
      selection: TextSelection.create(initial.doc, 1, 7),
    })

    expect(composerTrigger(state)).toBeNull()
  })
})
