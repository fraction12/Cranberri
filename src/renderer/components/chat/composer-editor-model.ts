import { Schema, Slice, type Node as ProseMirrorNode, type NodeSpec } from 'prosemirror-model'
import { EditorState, Selection, TextSelection } from 'prosemirror-state'

export type ComposerMentionKind = 'skill' | 'plugin'

export interface ComposerMention {
  kind: ComposerMentionKind
  id: string
  name: string
  displayName: string
  path: string
  description: string
  prompt?: string
}

export interface ComposerSnapshot {
  text: string
  plainText: string
  mentions: ComposerMention[]
}

export interface ComposerEditorSnapshot extends ComposerSnapshot {
  document: unknown
  selection: unknown
}

export interface ComposerTrigger {
  char: '/' | '$' | '@'
  from: number
  to: number
  query: string
}

export const COMPOSER_CLIPBOARD_MIME = 'application/x-cranberri-composer+json'

export interface ComposerClipboardPayload {
  version: 1
  text: string
  plainText: string
  mentions: ComposerMention[]
}

export function skillComposerMention(skill: {
  id: string
  name: string
  displayName: string
  path: string
  description: string
}): ComposerMention {
  return { kind: 'skill', ...skill }
}

export function pluginComposerMention(plugin: {
  id: string
  name: string
  displayName: string
  description: string
  prompt: string
}): ComposerMention {
  return {
    kind: 'plugin',
    id: plugin.id,
    name: plugin.name,
    displayName: plugin.displayName,
    path: `plugin://${plugin.id}`,
    description: plugin.description,
    prompt: plugin.prompt,
  }
}

const mentionAttrs = {
  id: { default: '' },
  name: { default: '' },
  displayName: { default: '' },
  path: { default: '' },
}

function mentionNodeSpec(kind: ComposerMentionKind): NodeSpec {
  return {
    attrs: mentionAttrs,
    atom: true,
    draggable: false,
    group: 'inline',
    inline: true,
    selectable: false,
    toDOM: (node) => ['span', {
      'data-composer-mention': kind,
      'data-mention-id': node.attrs.id,
      'data-mention-name': node.attrs.name,
      'data-mention-path': node.attrs.path,
    }],
  }
}

export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'] },
    skillMention: mentionNodeSpec('skill'),
    pluginMention: mentionNodeSpec('plugin'),
  },
  marks: {},
})

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function escapeHref(value: string): string {
  return value.replace(/([\\)])/g, '\\$1')
}

function mentionPromptText(mention: ComposerMention): string {
  const prefix = mention.kind === 'plugin' ? '@' : '$'
  return `[${prefix}${escapeLabel(mention.name)}](${escapeHref(mention.path)})`
}

function mentionFromNode(node: ProseMirrorNode): ComposerMention | null {
  const kind = node.type === composerSchema.nodes.skillMention
    ? 'skill'
    : node.type === composerSchema.nodes.pluginMention
      ? 'plugin'
      : null
  if (!kind) return null
  return {
    kind,
    id: String(node.attrs.id),
    name: String(node.attrs.name),
    displayName: String(node.attrs.displayName),
    path: String(node.attrs.path),
    description: '',
  }
}

function mentionNode(mention: ComposerMention): ProseMirrorNode {
  const type = mention.kind === 'skill' ? composerSchema.nodes.skillMention : composerSchema.nodes.pluginMention
  return type.create({
    id: mention.id,
    name: mention.name,
    displayName: mention.displayName,
    path: mention.path,
  })
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/g, '$1')
}

function inlineNodes(text: string, catalog: readonly ComposerMention[]): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  const pattern = /\[((?:\\.|[^\]])+)\]\(((?:\\.|[^)])+)\)/g
  let cursor = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const label = unescapeMarkdown(match[1])
    const path = unescapeMarkdown(match[2])
    const kind = label.startsWith('@') ? 'plugin' : label.startsWith('$') ? 'skill' : null
    if (!kind) continue
    if (match.index > cursor) nodes.push(composerSchema.text(text.slice(cursor, match.index)))
    const name = label.slice(1)
    const exactPathMatch = catalog.find((mention) => mention.kind === kind && mention.path === path)
    const nameMatches = path ? [] : catalog.filter((mention) => mention.kind === kind && mention.name === name)
    const known = exactPathMatch ?? (nameMatches.length === 1 ? nameMatches[0] : undefined)
    nodes.push(mentionNode(known ?? {
      kind,
      id: `${kind}:${path || name}`,
      name,
      displayName: name,
      path,
      description: '',
    }))
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) nodes.push(composerSchema.text(text.slice(cursor)))
  return nodes
}

export function composerStateFromText(text: string, catalog: readonly ComposerMention[] = []): EditorState {
  const paragraphs = text.split('\n').map((line) => composerSchema.nodes.paragraph.create(null, inlineNodes(line, catalog)))
  const doc = composerSchema.nodes.doc.create(null, paragraphs)
  return EditorState.create({ schema: composerSchema, doc, selection: TextSelection.atEnd(doc) })
}

export function composerStateFromSnapshot(
  snapshot: ComposerEditorSnapshot,
  catalog: readonly ComposerMention[] = [],
): EditorState {
  try {
    const doc = composerSchema.nodeFromJSON(snapshot.document)
    const selection = Selection.fromJSON(doc, snapshot.selection)
    return EditorState.create({ schema: composerSchema, doc, selection })
  } catch {
    return composerStateFromText(snapshot.text, catalog)
  }
}

export function composerSnapshot(doc: ProseMirrorNode): ComposerSnapshot {
  const mentions: ComposerMention[] = []
  const promptLines: string[] = []
  const plainLines: string[] = []
  doc.forEach((paragraph) => {
    let prompt = ''
    let plain = ''
    paragraph.forEach((node) => {
      if (node.isText) {
        const text = node.text ?? ''
        prompt += text
        plain += text
        return
      }
      if (node.type === composerSchema.nodes.hardBreak) {
        prompt += '\n'
        plain += '\n'
        return
      }
      const mention = mentionFromNode(node)
      if (!mention) return
      mentions.push(mention)
      prompt += mentionPromptText(mention)
      plain += mention.displayName
    })
    promptLines.push(prompt)
    plainLines.push(plain)
  })
  return { text: promptLines.join('\n'), plainText: plainLines.join('\n'), mentions }
}

export function composerClipboardPayload(
  state: EditorState,
): ComposerClipboardPayload | null {
  const { from, to } = state.selection
  if (from === to) return null
  const mentions: ComposerMention[] = []
  let text = ''
  let plainText = ''
  let paragraphCount = 0

  state.doc.descendants((node, position) => {
    if (node.type === composerSchema.nodes.paragraph) {
      const contentFrom = position + 1
      const contentTo = position + node.nodeSize - 1
      if (contentFrom <= to && contentTo >= from) {
        if (paragraphCount > 0) {
          text += '\n'
          plainText += '\n'
        }
        paragraphCount += 1
      }
      return true
    }

    if (node.isText) {
      const start = Math.max(from, position) - position
      const end = Math.min(to, position + node.nodeSize) - position
      if (start < end) {
        const selected = (node.text ?? '').slice(start, end)
        text += selected
        plainText += selected
      }
      return false
    }

    if (position >= to || position + node.nodeSize <= from) return false
    if (node.type === composerSchema.nodes.hardBreak) {
      text += '\n'
      plainText += '\n'
      return false
    }
    const mention = mentionFromNode(node)
    if (mention) {
      mentions.push(mention)
      text += mentionPromptText(mention)
      plainText += mention.displayName
    }
    return false
  })

  return { version: 1, text, plainText, mentions }
}

function isComposerMention(value: unknown): value is ComposerMention {
  if (!value || typeof value !== 'object') return false
  const mention = value as Partial<ComposerMention>
  return (mention.kind === 'skill' || mention.kind === 'plugin')
    && typeof mention.id === 'string'
    && typeof mention.name === 'string'
    && typeof mention.displayName === 'string'
    && typeof mention.path === 'string'
    && typeof mention.description === 'string'
    && (mention.prompt === undefined || typeof mention.prompt === 'string')
}

export function parseComposerClipboardPayload(value: string): ComposerClipboardPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<ComposerClipboardPayload>
    if (
      payload.version !== 1
      || typeof payload.text !== 'string'
      || typeof payload.plainText !== 'string'
      || !Array.isArray(payload.mentions)
      || !payload.mentions.every(isComposerMention)
    ) return null
    return payload as ComposerClipboardPayload
  } catch {
    return null
  }
}

export function replaceComposerSelectionWithClipboard(
  state: EditorState,
  payload: ComposerClipboardPayload,
  catalog: readonly ComposerMention[] = [],
): EditorState {
  const mentions = [...new Map(
    [...catalog, ...payload.mentions].map((mention) => [`${mention.kind}:${mention.path}`, mention]),
  ).values()]
  const incoming = composerStateFromText(payload.text, mentions)
  return state.apply(state.tr.replaceSelection(Slice.maxOpen(incoming.doc.content)).scrollIntoView())
}

export function composerEditorSnapshot(state: EditorState): ComposerEditorSnapshot {
  return {
    ...composerSnapshot(state.doc),
    document: state.doc.toJSON(),
    selection: state.selection.toJSON(),
  }
}

export function composerTrigger(state: EditorState): ComposerTrigger | null {
  const { selection } = state
  if (!selection.empty || !selection.$from.sameParent(selection.$to)) return null
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', '\uFFFC')
  const match = text.match(/(^|\s)([/@$])([^\s\uFFFC]*)$/)
  if (!match || (match[2] !== '/' && match[2] !== '$' && match[2] !== '@')) return null
  const tokenLength = match[2].length + match[3].length
  return {
    char: match[2],
    from: selection.from - tokenLength,
    to: selection.from,
    query: match[3].toLowerCase(),
  }
}

export function insertComposerMention(
  state: EditorState,
  mention: ComposerMention,
  range: { from: number; to: number } = { from: state.selection.from, to: state.selection.to },
): EditorState {
  const node = mentionNode(mention)
  let transaction = state.tr.replaceRangeWith(range.from, range.to, node)
  const nodeEnd = range.from + node.nodeSize
  const following = transaction.doc.textBetween(nodeEnd, Math.min(nodeEnd + 1, transaction.doc.content.size), '', '\uFFFC')
  const needsSpace = following.length === 0 || !/^\s/.test(following)
  if (needsSpace) transaction = transaction.insertText(' ', nodeEnd)
  const cursor = nodeEnd + (needsSpace ? 1 : 0)
  transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(cursor), 1))
  return state.apply(transaction)
}
