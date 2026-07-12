import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { boundedCodeText, displayLanguage, focusedCodePreview, languageFromFileName, type FocusedCodePreviewLine } from './code-utils'
import { useAppearance } from '../../state/appearance-context'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { IconButton } from '../ui/IconButton'

const DEFAULT_MAX_LINES = 1200
const MAX_HIGHLIGHT_CHARS = 40000

interface CodePreviewProps {
  code: string
  language?: string
  filePath?: string | null
  focusLine?: number | null
  maxLines?: number
  className?: string
}

export function preloadCodePreview(): void {
  void import('shiki').catch(() => undefined)
}

export function CodePreview({
  code,
  language,
  filePath,
  focusLine,
  maxLines = DEFAULT_MAX_LINES,
  className = '',
}: CodePreviewProps) {
  const { theme } = useAppearance()
  const [html, setHtml] = useState<string | null>(null)
  const [highlightFailed, setHighlightFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const resolvedLanguage = displayLanguage(language, filePath)
  const bounded = useMemo(() => boundedCodeText(code, maxLines), [code, maxLines])
  const focused = useMemo(() => focusedCodePreview(code, maxLines, focusLine), [code, focusLine, maxLines])
  const isFocusedPreview = Boolean(focused.focusLine)
  const canHighlight = !isFocusedPreview && bounded.text.length <= MAX_HIGHLIGHT_CHARS

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setHighlightFailed(false)

    if (!canHighlight) return undefined

    import('shiki')
      .then(({ codeToHtml }) => codeToHtml(bounded.text, {
        lang: resolvedLanguage,
        theme: theme === 'dark' ? 'github-dark-default' : 'github-light-default',
      }))
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHighlightFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [bounded.text, canHighlight, resolvedLanguage, theme])

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <figure
      className={cn('my-4 overflow-hidden rounded-lg bg-app-surface ring-1 ring-app-border/70', className)}
      data-code-preview="true"
      data-language={resolvedLanguage}
    >
      <figcaption className={cn(
        typeStyle({ role: 'metadata', tone: 'secondary' }),
        'flex h-8 items-center justify-between bg-app-surface-2/70 px-3',
      )}>
        <span className="truncate">{filePath ?? resolvedLanguage}</span>
        <span className="flex items-center gap-2">
          <span>{focused.focusLine ? `line ${focused.focusLine}` : highlightFailed || !canHighlight ? 'plain' : resolvedLanguage}</span>
          <IconButton
            type="button"
            onClick={() => void copyCode()}
            className="h-6 w-6"
            label="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
          {copied && <span className={cn(typeStyle({ role: 'status', tone: 'success' }), 'normal-case')}>Copied</span>}
        </span>
      </figcaption>
      {isFocusedPreview ? (
        <FocusedPlainPreview preview={focused} />
      ) : html ? (
        <div
          className={cn(
            typeStyle({ role: 'code' }),
            'max-h-[640px] overflow-auto [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!bg-app-surface [&_pre]:!p-3',
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={cn(typeStyle({ role: 'code' }), 'max-h-[640px] overflow-auto whitespace-pre bg-app-surface p-3')}>
          <code>{bounded.text}</code>
        </pre>
      )}
      {isFocusedPreview && (focused.truncatedBefore || focused.truncatedAfter) ? (
        <div className={cn(typeStyle({ role: 'micro', tone: 'secondary' }), 'bg-app-surface-2/70 px-3 py-1.5')}>
          Showing lines {focused.lines[0]?.number ?? 1}-{focused.lines.at(-1)?.number ?? focused.lineCount} of {focused.lineCount}.
        </div>
      ) : bounded.truncated && (
        <div className={cn(typeStyle({ role: 'micro', tone: 'secondary' }), 'bg-app-surface-2/70 px-3 py-1.5')}>
          Showing {maxLines} of {bounded.lineCount} lines.
        </div>
      )}
    </figure>
  )
}

function FocusedPlainPreview({ preview }: { preview: ReturnType<typeof focusedCodePreview> }) {
  return (
    <pre className={cn(typeStyle({ role: 'code' }), 'max-h-[640px] overflow-auto bg-app-surface p-0')}>
      {preview.truncatedBefore && <CodeGap label="Earlier lines hidden" />}
      {preview.lines.map((line) => <CodeLine key={line.number} line={line} />)}
      {preview.truncatedAfter && <CodeGap label="Later lines hidden" />}
    </pre>
  )
}

function CodeLine({ line }: { line: FocusedCodePreviewLine }) {
  return (
    <span className={`block whitespace-pre ${line.focused ? 'bg-app-accent/15 text-app-text' : ''}`} data-focused-line={line.focused ? 'true' : undefined}>
      <span className="inline-block w-12 select-none pr-2 text-right text-app-text-tertiary">{line.number}</span>
      <code className="pl-3">{line.text || ' '}</code>
      {'\n'}
    </span>
  )
}

function CodeGap({ label }: { label: string }) {
  return (
    <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'block bg-app-surface-2/70 px-3 py-1')}>
      {label}
      {'\n'}
    </span>
  )
}

export function FileCodePreview({ code, filePath, focusLine }: { code: string; filePath: string; focusLine?: number | null }) {
  return (
    <CodePreview
      code={code}
      filePath={filePath}
      language={languageFromFileName(filePath)}
      focusLine={focusLine}
      className="m-0 h-full rounded-none ring-0"
    />
  )
}
