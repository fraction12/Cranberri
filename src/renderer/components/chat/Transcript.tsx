import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, ExternalLink, Github, Package, Plug } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { CodexMessage, CodexSkillInfo } from '@/shared/codex'

type SkillRenderer = (text: string, skills: CodexSkillInfo[]) => ReactNode[]
const PING_DOT_CLASS = 'absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40'
const USER_BUBBLE_CLASS = [
  'max-w-[76%] rounded-2xl bg-[var(--app-surface)] px-2.5 py-1.5',
  'text-[13px] leading-5 text-[var(--app-text)]',
  'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]',
].join(' ')
const CODE_INLINE_CLASS = [
  'rounded-md bg-[var(--app-surface-2)] px-1.5 py-0.5 font-mono text-[0.92em]',
  'text-[var(--app-text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]',
].join(' ')
const MENTION_PILL_CLASS = [
  'inline-flex max-w-full items-center gap-1 rounded-full bg-[#ff8f8f]/10 px-2 py-0.5',
  'align-baseline text-[0.92em] font-medium text-[#ffb3b3]',
  'shadow-[inset_0_0_0_1px_rgba(255,143,143,0.18)]',
].join(' ')
const INLINE_TOKEN_PATTERN = /(`[^`]+`|\[[^\]\n]+\]\([^)\n]+\))/g
const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/

type MentionLink = {
  kind: 'plugin' | 'skill'
  label: string
}

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
  return ''
}

function classifyMentionLink(label: string, href?: string, options: { allowMissingPluginHref?: boolean } = {}): MentionLink | null {
  const visibleLabel = label.trim()
  if (visibleLabel.length === 0) return null
  if (visibleLabel.startsWith('@') && (href?.startsWith('plugin://') || (!href && options.allowMissingPluginHref))) {
    return { kind: 'plugin', label: visibleLabel }
  }
  if (visibleLabel.startsWith('$')) return { kind: 'skill', label: visibleLabel }
  return null
}

function parseMarkdownLink(text: string): { label: string; href: string } | null {
  const match = text.match(MARKDOWN_LINK_PATTERN)
  if (!match) return null
  return { label: match[1], href: match[2] }
}

function MentionPill({ mention }: { mention: MentionLink }) {
  const Icon = mention.kind === 'plugin' ? Plug : Package
  return (
    <span className={MENTION_PILL_CLASS} data-mention-kind={mention.kind}>
      <Icon className="h-[0.9em] w-[0.9em] shrink-0" />
      <span className="min-w-0 truncate">{mention.label}</span>
    </span>
  )
}

export function formatInlineCodexText(text: string) {
  const parts = text.split(INLINE_TOKEN_PATTERN)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className={CODE_INLINE_CLASS}>
          {part.slice(1, -1)}
        </code>
      )
    }

    const link = parseMarkdownLink(part)
    if (link) {
      const mention = classifyMentionLink(link.label, link.href)
      if (mention) return <MentionPill key={index} mention={mention} />
    }

    return <span key={index}>{part}</span>
  })
}

const MARKDOWN_COMPONENTS: Components = {
  p({ children }) {
    return <p className="my-3 first:mt-0 last:mb-0">{children}</p>
  },
  a({ href, children }) {
    const mention = classifyMentionLink(childrenToText(children), href, { allowMissingPluginHref: true })
    if (mention) return <MentionPill mention={mention} />

    if (!isExternalUrl(href)) {
      return <span className="text-[#ffb3b3]">{children}</span>
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
        className="inline-flex items-center gap-1 rounded-md text-[#ffb3b3] decoration-[#ffb3b3]/60 underline-offset-4 hover:underline"
      >
        {isGitHubLink ? <Github className="h-[1em] w-[1em]" /> : null}
        <span>{children}</span>
        {!isGitHubLink ? <ExternalLink className="h-[0.9em] w-[0.9em] opacity-70" /> : null}
      </a>
    )
  },
  code({ className, children }) {
    const isBlock = Boolean(className)
    if (isBlock) {
      return <code className={`${className ?? ''} font-mono text-[13px] leading-6`}>{children}</code>
    }
    return <code className={CODE_INLINE_CLASS}>{children}</code>
  },
  pre({ children }) {
    return (
      <pre className="my-4 overflow-x-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 text-[13px] leading-6">
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
        <table className="w-full border-collapse text-left text-[13px]">{children}</table>
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

export function formatCodexText(text: string, options: { hideAppDirectives?: boolean } = {}) {
  const markdown = options.hideAppDirectives ? stripCodexAppDirectives(text) : text
  if (!markdown) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={MARKDOWN_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  )
}

function MessageActions({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 text-[var(--app-text-muted)] opacity-80">
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(text).catch((error) => console.error('Failed to copy response:', error))}
        className="rounded p-0.5 hover:text-[var(--app-text)]"
        aria-label="Copy response"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ReasoningGroup({
  messages,
  expanded,
  onToggle,
  isRunning,
  activity,
  durationMs,
  runStartedAt,
  renderSkillText,
}: {
  messages: CodexMessage[]
  expanded: boolean
  onToggle: () => void
  isRunning: boolean
  activity?: string
  durationMs?: number
  runStartedAt?: number
  renderSkillText: SkillRenderer
}) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const displayedDurationMs = isRunning ? elapsedMs : (durationMs ?? 0)

  useEffect(() => {
    if (!isRunning) return undefined
    const start = runStartedAt ?? Date.now()
    setElapsedMs(Date.now() - start)
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => window.clearInterval(id)
  }, [isRunning, runStartedAt])

  if (messages.length === 0 && !isRunning) return null

  const seconds = Math.max(1, Math.round(displayedDurationMs / 1000))

  return (
    <div className="max-w-full text-[var(--app-text-muted)]">
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex items-center gap-2 text-xs hover:text-[var(--app-text)]"
      >
        {isRunning ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className={PING_DOT_CLASS} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--app-text-muted)]" />
        )}
        <span>{isRunning ? `${activity ?? 'Working'} · ${seconds}s` : `Worked${durationMs ? ` for ${seconds}s` : ''}`}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-5 border-l border-[var(--app-border)] pl-4">
          {messages.map((message) => (
            <TranscriptMessage key={message.id} msg={message} renderSkillText={renderSkillText} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TranscriptMessage({
  msg,
  skills = [],
  renderSkillText,
}: {
  msg: CodexMessage
  skills?: CodexSkillInfo[]
  renderSkillText: SkillRenderer
}) {
  if (msg.role === 'system' || msg.role === 'reasoning') {
    return (
      <div className="max-w-full text-[13px] leading-5 text-[var(--app-text-muted)]">
        <div className="whitespace-pre-wrap">{formatInlineCodexText(msg.content)}</div>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className={USER_BUBBLE_CLASS}>
          <div className="whitespace-pre-wrap">{renderSkillText(msg.content, skills)}</div>
        </div>
      </div>
    )
  }

  return (
    <article className="max-w-full text-[15px] leading-7 text-[var(--app-text)]">
      <div className="break-words">{formatCodexText(msg.content, { hideAppDirectives: true })}</div>
      <MessageActions text={msg.content} />
    </article>
  )
}
