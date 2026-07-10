import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, Github } from 'lucide-react'
import { CodePreview } from '../editor/CodePreview'
import { languageFromMarkdownClass } from '../editor/code-utils'
import { CODE_INLINE_CLASS, MentionPill, classifyMentionLink } from './mention-pill'
import { isValidElement, type ReactNode } from 'react'
import { MermaidDiagram } from './MermaidDiagram'
import { MarkdownMedia, markdownMediaSourceFromUrl } from './MarkdownMedia'

function stripCodexAppDirectives(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^::[a-z][a-z-]*\{.*\}\s*$/.test(line.trim()))
    .join('\n')
    .trim()
}

function isExternalUrl(href?: string): href is string {
  return Boolean(href?.startsWith('http://') || href?.startsWith('https://'))
}

function openExternalLink(href: string): void {
  window.cranberri.openExternal(href).catch((error) => console.error('Failed to open link:', error))
}

function childrenToText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (isValidElement<{ children?: ReactNode }>(children)) return childrenToText(children.props.children)
  return ''
}

function codeElementFromPreChildren(children: ReactNode): React.ReactElement<{ className?: string; children?: ReactNode }> | null {
  const candidates = Array.isArray(children) ? children : [children]
  for (const child of candidates) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) continue
    if (typeof child.props.className === 'string' && child.props.className.includes('language-')) return child
  }
  return null
}

const MARKDOWN_COMPONENTS: Components = {
  p({ children }) {
    return <p className="my-3 first:mt-0 last:mb-0">{children}</p>
  },
  a({ href, children }) {
    const mention = classifyMentionLink(childrenToText(children), href, { allowMissingPluginHref: true })
    if (mention) return <MentionPill mention={mention} />

    const media = markdownMediaSourceFromUrl(href)
    if (media) return <MarkdownMedia source={media} label={childrenToText(children)} />

    if (!isExternalUrl(href)) {
      return <span className="text-app-mention">{children}</span>
    }

    const isGitHubLink = href.startsWith('https://github.com/')
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault()
          openExternalLink(href)
        }}
        className="inline-flex items-center gap-1 rounded-md text-app-mention decoration-app-mention/60 underline-offset-4 hover:underline"
      >
        {isGitHubLink ? <Github className="h-[1em] w-[1em]" /> : null}
        <span>{children}</span>
        {!isGitHubLink ? <ExternalLink className="h-[0.9em] w-[0.9em] opacity-70" /> : null}
      </a>
    )
  },
  img({ src, alt }) {
    const media = markdownMediaSourceFromUrl(src)
    if (media?.kind === 'image') return <MarkdownMedia source={media} label={alt} />
    return <span className="text-app-mention">{alt || 'Image unavailable'}</span>
  },
  code({ className, children }) {
    const isBlock = Boolean(className)
    if (isBlock) {
      return <code className={className}>{children}</code>
    }
    return <code className={CODE_INLINE_CLASS}>{children}</code>
  },
  pre({ children }) {
    const codeChild = codeElementFromPreChildren(children)
    if (codeChild) {
      const language = languageFromMarkdownClass(codeChild.props.className)
      const code = childrenToText(codeChild.props.children).replace(/\n$/, '')
      if (language === 'mermaid') return <MermaidDiagram source={code} />
      return (
        <CodePreview
          code={code}
          language={language}
        />
      )
    }
    return (
      <pre className="my-4 overflow-x-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-sm leading-6">
        {children}
      </pre>
    )
  },
  ul({ children }) {
    return <ul className="my-3 list-disc space-y-2 pl-6 marker:text-[var(--app-text-muted)]">{children}</ul>
  },
  ol({ children }) {
    return <ol className="my-3 list-decimal space-y-2 pl-6 marker:text-[var(--app-text-muted)]">{children}</ol>
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>
  },
  blockquote({ children }) {
    return <blockquote className="my-4 border-l-2 border-[var(--app-border)] pl-4 text-[var(--app-text-muted)]">{children}</blockquote>
  },
  hr() {
    return <hr className="my-5 border-[var(--app-border)]" />
  },
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg border border-[var(--app-border)]">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    )
  },
  th({ children }) {
    return <th className="border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 font-medium">{children}</th>
  },
  td({ children }) {
    return <td className="border-t border-[var(--app-border)] px-3 py-2 align-top">{children}</td>
  },
}

interface FormatCodexTextOptions {
  hideAppDirectives?: boolean
  streaming?: boolean
}

export function formatCodexText(text: string, options: FormatCodexTextOptions = {}) {
  const markdown = options.hideAppDirectives ? stripCodexAppDirectives(text) : text
  if (!markdown) return null
  if (options.streaming) {
    return (
      <div data-streaming-markdown="true" className="whitespace-pre-wrap break-words">
        {markdown}
      </div>
    )
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  )
}

export function MarkdownContent({
  text,
  hideAppDirectives = false,
  streaming = false,
}: {
  text: string
  hideAppDirectives?: boolean
  streaming?: boolean
}) {
  return <>{formatCodexText(text, { hideAppDirectives, streaming })}</>
}
