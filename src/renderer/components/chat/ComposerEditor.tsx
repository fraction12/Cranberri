import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { baseKeymap } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, Selection, TextSelection, type Command } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { MentionPill } from './mention-pill'
import {
  composerSchema,
  COMPOSER_CLIPBOARD_MIME,
  composerClipboardPayload,
  composerEditorSnapshot,
  composerStateFromSnapshot,
  composerStateFromText,
  composerTrigger,
  insertComposerMention,
  parseComposerClipboardPayload,
  replaceComposerSelectionWithClipboard,
  type ComposerMention,
  type ComposerEditorSnapshot,
  type ComposerTrigger,
} from './composer-editor-model'

export interface ComposerEditorHandle {
  focus: (position?: 'start' | 'end') => void
  insertDictation: (text: string) => void
  insertMention: (mention: ComposerMention, range?: { from: number; to: number }) => void
  insertText: (text: string, range?: { from: number; to: number }) => void
  replaceHistorySnapshot: (snapshot: ComposerEditorSnapshot) => void
  snapshot: () => ComposerEditorSnapshot
}

interface ComposerEditorProps {
  value: string
  catalog: readonly ComposerMention[]
  placeholder: string
  disabled?: boolean
  suggestionOpen?: boolean
  suggestionListId?: string
  activeSuggestionId?: string
  onChange: (snapshot: ComposerEditorSnapshot) => void
  onTriggerChange: (trigger: ComposerTrigger | null) => void
  onSubmit: () => void
  onEditorKeyDown: (event: KeyboardEvent, context: { atDocumentStart: boolean; atDocumentEnd: boolean }) => boolean
  onPaste: (data: DataTransfer) => boolean
  onDrop: (data: DataTransfer) => boolean
}

function editorAttributes(
  placeholder: string,
  disabled: boolean,
  suggestionOpen: boolean,
  suggestionListId?: string,
  activeSuggestionId?: string,
): Record<string, string> {
  return {
    'aria-label': 'Chat message',
    'aria-disabled': String(disabled),
    'aria-expanded': String(suggestionOpen),
    'aria-autocomplete': 'list',
    'aria-haspopup': 'listbox',
    'aria-multiline': 'true',
    'aria-placeholder': placeholder,
    ...(suggestionOpen && suggestionListId ? { 'aria-controls': suggestionListId } : {}),
    ...(suggestionOpen && activeSuggestionId ? { 'aria-activedescendant': activeSuggestionId } : {}),
    'data-composer-input': 'true',
    role: 'textbox',
    spellcheck: 'true',
  }
}

function mentionNodeView(node: ProseMirrorNode): NodeView {
  const kind = node.type === composerSchema.nodes.pluginMention ? 'plugin' : 'skill'
  const dom = document.createElement('span')
  dom.contentEditable = 'false'
  dom.dataset.composerMention = kind
  dom.dataset.mentionId = String(node.attrs.id)
  let root: Root | null = createRoot(dom)
  flushSync(() => root?.render(<MentionPill mention={{ kind, label: String(node.attrs.displayName) }} variant="composer" />))
  return {
    dom,
    destroy: () => {
      const current = root
      root = null
      queueMicrotask(() => current?.unmount())
    },
  }
}

function submitCommand(submit: () => void): Command {
  return () => {
    submit()
    return true
  }
}

function newlineCommand(): Command {
  return (state, dispatch) => {
    if (!dispatch) return true
    dispatch(state.tr.replaceSelectionWith(composerSchema.nodes.hardBreak.create()).scrollIntoView())
    return true
  }
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor({
  value,
  catalog,
  placeholder,
  disabled = false,
  suggestionOpen = false,
  suggestionListId,
  activeSuggestionId,
  onChange,
  onTriggerChange,
  onSubmit,
  onEditorKeyDown,
  onPaste,
  onDrop,
}, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lastEmittedValueRef = useRef(value)
  const initialValueRef = useRef(value)
  const initialCatalogRef = useRef(catalog)
  const lastCatalogRef = useRef(catalog)
  const initialPlaceholderRef = useRef(placeholder)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const suggestionStateRef = useRef({ suggestionOpen, suggestionListId, activeSuggestionId })
  suggestionStateRef.current = { suggestionOpen, suggestionListId, activeSuggestionId }
  const callbacksRef = useRef({ onChange, onDrop, onEditorKeyDown, onPaste, onSubmit, onTriggerChange })
  callbacksRef.current = { onChange, onDrop, onEditorKeyDown, onPaste, onSubmit, onTriggerChange }

  const emitState = useCallback((state: EditorState) => {
    const snapshot = composerEditorSnapshot(state)
    lastEmittedValueRef.current = snapshot.text
    callbacksRef.current.onChange(snapshot)
    callbacksRef.current.onTriggerChange(composerTrigger(state))
  }, [])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    const initial = composerStateFromText(initialValueRef.current, initialCatalogRef.current)
    const plugins = [
      history(),
      keymap({
        'Mod-z': undo,
        'Shift-Mod-z': redo,
        'Mod-y': redo,
        'Shift-Enter': newlineCommand(),
        'Alt-Enter': newlineCommand(),
        'Mod-Enter': submitCommand(() => callbacksRef.current.onSubmit()),
        Enter: submitCommand(() => callbacksRef.current.onSubmit()),
      }),
      keymap(baseKeymap),
    ]
    const state = EditorState.create({ schema: composerSchema, doc: initial.doc, selection: initial.selection, plugins })
    const view = new EditorView(mount, {
      state,
      editable: () => !disabledRef.current,
      attributes: editorAttributes(initialPlaceholderRef.current, disabledRef.current,
        suggestionStateRef.current.suggestionOpen,
        suggestionStateRef.current.suggestionListId,
        suggestionStateRef.current.activeSuggestionId),
      nodeViews: {
        skillMention: mentionNodeView,
        pluginMention: mentionNodeView,
      },
      handleDOMEvents: {
        keydown: (currentView, event) => {
          if (event.isComposing || event.keyCode === 229) return true
          const { selection, doc } = currentView.state
          return callbacksRef.current.onEditorKeyDown(event, {
            atDocumentStart: selection.empty && selection.from === TextSelection.atStart(doc).from,
            atDocumentEnd: selection.empty && selection.to === TextSelection.atEnd(doc).to,
          })
        },
        copy: (currentView, event) => {
          const payload = composerClipboardPayload(currentView.state)
          if (!event.clipboardData || !payload) return false
          event.clipboardData.setData(COMPOSER_CLIPBOARD_MIME, JSON.stringify(payload))
          event.clipboardData.setData('text/plain', payload.plainText)
          event.preventDefault()
          return true
        },
        cut: (currentView, event) => {
          const payload = composerClipboardPayload(currentView.state)
          if (!event.clipboardData || !payload) return false
          event.clipboardData.setData(COMPOSER_CLIPBOARD_MIME, JSON.stringify(payload))
          event.clipboardData.setData('text/plain', payload.plainText)
          currentView.dispatch(currentView.state.tr.deleteSelection().scrollIntoView())
          event.preventDefault()
          return true
        },
        paste: (currentView, event) => {
          if (!event.clipboardData) return false
          const structured = parseComposerClipboardPayload(event.clipboardData.getData(COMPOSER_CLIPBOARD_MIME))
          if (structured) {
            const next = replaceComposerSelectionWithClipboard(currentView.state, structured, lastCatalogRef.current)
            currentView.updateState(next)
            emitState(next)
            event.preventDefault()
            return true
          }
          if (!callbacksRef.current.onPaste(event.clipboardData)) return false
          event.preventDefault()
          return true
        },
        drop: (_view, event) => {
          if (!event.dataTransfer || !callbacksRef.current.onDrop(event.dataTransfer)) return false
          event.preventDefault()
          return true
        },
        blur: () => {
          callbacksRef.current.onTriggerChange(null)
          return false
        },
      },
      dispatchTransaction: (transaction) => {
        const next = view.state.apply(transaction)
        view.updateState(next)
        if (transaction.docChanged) emitState(next)
        else callbacksRef.current.onTriggerChange(composerTrigger(next))
      },
    })
    viewRef.current = view
    callbacksRef.current.onTriggerChange(composerTrigger(view.state))
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [emitState])

  useEffect(() => {
    const view = viewRef.current
    const catalogChanged = catalog !== lastCatalogRef.current
    lastCatalogRef.current = catalog
    if (!view || (value === lastEmittedValueRef.current && !catalogChanged)) return
    const next = composerStateFromText(value, catalog)
    if (view.state.doc.eq(next.doc)) return
    const preserveSelection = value === lastEmittedValueRef.current
    const selectionPosition = Math.min(view.state.selection.from, next.doc.content.size)
    let transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, next.doc.content)
    transaction = transaction.setSelection(preserveSelection
      ? TextSelection.near(transaction.doc.resolve(selectionPosition))
      : TextSelection.atEnd(transaction.doc))
    view.dispatch(transaction)
  }, [catalog, value])

  useEffect(() => {
    viewRef.current?.setProps({
      editable: () => !disabled,
      attributes: editorAttributes(placeholder, disabled, suggestionOpen, suggestionListId, activeSuggestionId),
    })
  }, [activeSuggestionId, disabled, placeholder, suggestionListId, suggestionOpen])

  useImperativeHandle(forwardedRef, () => ({
    focus: (position) => {
      const view = viewRef.current
      if (!view) return
      if (position) {
        const selection = position === 'start' ? TextSelection.atStart(view.state.doc) : TextSelection.atEnd(view.state.doc)
        view.dispatch(view.state.tr.setSelection(selection))
      }
      view.focus()
    },
    insertMention: (mention, range) => {
      const view = viewRef.current
      if (!view) return
      const next = insertComposerMention(view.state, mention, range)
      view.updateState(next)
      emitState(next)
      view.focus()
    },
    insertDictation: (text) => {
      const view = viewRef.current
      const transcript = text.trim()
      if (!view || !transcript) return
      const { from, to } = view.state.selection
      const before = view.state.doc.textBetween(Math.max(0, from - 1), from, '', '\uFFFC')
      const after = view.state.doc.textBetween(to, Math.min(view.state.doc.content.size, to + 1), '', '\uFFFC')
      const insertion = `${before && !/\s$/.test(before) ? ' ' : ''}${transcript}${after && !/^\s/.test(after) ? ' ' : ''}`
      view.dispatch(view.state.tr.insertText(insertion, from, to).scrollIntoView())
      view.focus()
    },
    insertText: (text, range) => {
      const view = viewRef.current
      if (!view || !text) return
      const { from, to } = range ?? view.state.selection
      view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
      view.focus()
    },
    replaceHistorySnapshot: (snapshot) => {
      const view = viewRef.current
      if (!view) return
      const restored = composerStateFromSnapshot(snapshot, lastCatalogRef.current)
      let transaction = view.state.tr
        .replaceWith(0, view.state.doc.content.size, restored.doc.content)
        .setMeta('addToHistory', false)
      try {
        transaction = transaction.setSelection(Selection.fromJSON(transaction.doc, snapshot.selection))
      } catch {
        transaction = transaction.setSelection(TextSelection.atEnd(transaction.doc))
      }
      view.dispatch(transaction.scrollIntoView())
      view.focus()
    },
    snapshot: () => {
      const state = viewRef.current?.state ?? composerStateFromText('')
      return composerEditorSnapshot(state)
    },
  }), [emitState])

  const empty = value.length === 0
  return (
    <div
      data-composer-viewport="true"
      className={cn(
        'relative min-h-[44px] max-h-[25dvh] overflow-y-auto overscroll-contain px-1',
        typeStyle({ role: 'body' }),
        '[&_.ProseMirror]:min-h-[44px] [&_.ProseMirror]:whitespace-pre-wrap [&_.ProseMirror]:break-words',
        '[&_.ProseMirror]:caret-[var(--app-text)] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0',
        disabled && 'opacity-55',
      )}
    >
      {empty && <div className="pointer-events-none absolute inset-x-1 top-0 text-app-text-muted">{placeholder}</div>}
      <div ref={mountRef} data-composer-editor="true" />
    </div>
  )
})
