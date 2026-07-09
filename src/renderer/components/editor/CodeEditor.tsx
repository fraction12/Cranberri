import { useEffect, useRef } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView as CodeMirrorEditorView, type EditorView as EditorViewType } from '@codemirror/view'
import { languageFromFileName } from './code-utils'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  filePath?: string | null
  language?: string
  readOnly?: boolean
  lineWrap?: boolean
  focusLine?: number | null
  searchRequest?: number
}

async function languageExtension(language?: string): Promise<Extension[]> {
  switch (language) {
    case 'css': {
      const { css } = await import('@codemirror/lang-css')
      return [css()]
    }
    case 'html': {
      const { html } = await import('@codemirror/lang-html')
      return [html()]
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return [markdown()]
    }
    case 'javascript':
    case 'jsx':
    case 'typescript':
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return [javascript({ jsx: language === 'jsx' || language === 'tsx', typescript: language === 'typescript' || language === 'tsx' })]
    }
    default:
      return []
  }
}

export function CodeEditor({
  value,
  onChange,
  filePath,
  language,
  readOnly = false,
  lineWrap = true,
  focusLine,
  searchRequest = 0,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorViewType | null>(null)
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  initialValueRef.current = value
  onChangeRef.current = onChange

  useEffect(() => {
    let disposed = false

    async function mount() {
      const [{ EditorState }, { EditorView, Decoration }, { basicSetup }, extensions] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('codemirror'),
        languageExtension(language ?? languageFromFileName(filePath)),
      ])
      if (disposed || !hostRef.current) return

      const editorExtensions: Extension[] = [
        basicSetup,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            backgroundColor: 'var(--app-bg)',
            color: 'var(--app-text)',
            fontSize: 'var(--app-code-font-size)',
          },
          '.cm-scroller': {
            fontFamily: 'var(--app-font-mono)',
            lineHeight: '1.55',
          },
          '.cm-content': {
            padding: '12px 0',
          },
          '.cm-line': {
            paddingLeft: '12px',
            paddingRight: '12px',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--app-bg)',
            borderRight: '1px solid var(--app-border)',
            color: 'var(--app-text-muted)',
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor: 'var(--app-active-line)',
          },
          '.cranberri-cm-focused-line': {
            backgroundColor: 'var(--app-accent-soft)',
            boxShadow: 'inset 2px 0 0 var(--app-accent)',
          },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--app-accent-selection)',
          },
          '&.cm-focused': {
            outline: 'none',
          },
          '.cm-panels': {
            backgroundColor: 'var(--app-surface-2)',
            borderColor: 'var(--app-border)',
            color: 'var(--app-text)',
          },
          '.cm-panel input': {
            backgroundColor: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            borderRadius: '4px',
            color: 'var(--app-text)',
            outline: 'none',
          },
        }),
        ...extensions,
      ]
      if (lineWrap) editorExtensions.push(EditorView.lineWrapping)
      if (focusLine && Number.isFinite(focusLine)) {
        editorExtensions.push(EditorView.decorations.of((view) => {
          const lineNumber = Math.min(Math.max(Math.floor(focusLine), 1), view.state.doc.lines)
          const line = view.state.doc.line(lineNumber)
          return Decoration.set([Decoration.line({ class: 'cranberri-cm-focused-line' }).range(line.from)])
        }))
      }

      viewRef.current = new EditorView({
        state: EditorState.create({ doc: initialValueRef.current, extensions: editorExtensions }),
        parent: hostRef.current,
      })
      scrollToFocusLine(viewRef.current, focusLine)
    }

    void mount()
    return () => {
      disposed = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [filePath, focusLine, language, lineWrap, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    scrollToFocusLine(view, focusLine)
  }, [focusLine, value])

  useEffect(() => {
    scrollToFocusLine(viewRef.current, focusLine)
  }, [focusLine])

  useEffect(() => {
    if (!searchRequest || !viewRef.current) return
    const view = viewRef.current
    void import('@codemirror/search').then(({ openSearchPanel }) => {
      if (viewRef.current !== view) return
      openSearchPanel(view)
      view.focus()
    })
  }, [searchRequest])

  return <div ref={hostRef} className="h-full min-h-0 text-code" data-code-editor="true" data-focus-line={focusLine ?? undefined} />
}

function scrollToFocusLine(view: EditorViewType | null, focusLine?: number | null): void {
  if (!view || !focusLine || !Number.isFinite(focusLine)) return
  const lineNumber = Math.min(Math.max(Math.floor(focusLine), 1), view.state.doc.lines)
  const line = view.state.doc.line(lineNumber)
  view.dispatch({
    selection: { anchor: line.from },
    effects: CodeMirrorEditorView.scrollIntoView(line.from, { y: 'center' }),
  })
}
