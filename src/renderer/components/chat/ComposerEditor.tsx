import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { baseKeymap } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { MentionPill } from './mention-pill'
import {
  composerSchema,
  composerSnapshot,
  composerStateFromText,
  composerTrigger,
  insertComposerMention,
  type ComposerMention,
  type ComposerSnapshot,
  type ComposerTrigger,
} from './composer-editor-model'

export interface ComposerEditorHandle {
  focus: (position?: 'start' | 'end') => void
  insertDictation: (text: string) => void
  insertMention: (mention: ComposerMention, range?: { from: number; to: number }) => void
  insertText: (text: string, range?: { from: number; to: number }) => void
  snapshot: () => ComposerSnapshot
}

interface ComposerEditorProps {
  value: string
  catalog: readonly ComposerMention[]
  placeholder: string
  disabled?: boolean
  onChange: (snapshot: ComposerSnapshot) => void
  onTriggerChange: (trigger: ComposerTrigger | null) => void
  onSubmit: () => void
  onSuggestionKeyDown: (event: KeyboardEvent) => boolean
  onPaste: (data: DataTransfer) => boolean
  onDrop: (data: DataTransfer) => boolean
}

function editorAttributes(placeholder: string): Record<string, string> {
  return {
    'aria-label': 'Chat message',
    'aria-multiline': 'true',
    'aria-placeholder': placeholder,
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
  onChange,
  onTriggerChange,
  onSubmit,
  onSuggestionKeyDown,
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
  const callbacksRef = useRef({ onChange, onDrop, onPaste, onSubmit, onSuggestionKeyDown, onTriggerChange })
  callbacksRef.current = { onChange, onDrop, onPaste, onSubmit, onSuggestionKeyDown, onTriggerChange }

  const emitState = useCallback((state: EditorState) => {
    const snapshot = composerSnapshot(state.doc)
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
      attributes: editorAttributes(initialPlaceholderRef.current),
      nodeViews: {
        skillMention: mentionNodeView,
        pluginMention: mentionNodeView,
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if (event.isComposing || event.keyCode === 229) return true
          return callbacksRef.current.onSuggestionKeyDown(event)
        },
        paste: (_view, event) => {
          if (!event.clipboardData || !callbacksRef.current.onPaste(event.clipboardData)) return false
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
    viewRef.current?.setProps({ editable: () => !disabled })
  }, [disabled])

  useEffect(() => {
    viewRef.current?.setProps({ attributes: editorAttributes(placeholder) })
  }, [placeholder])

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
    snapshot: () => composerSnapshot(viewRef.current?.state.doc ?? composerStateFromText('').doc),
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
