import { Package, Plug } from 'lucide-react'
import type { ReactNode } from 'react'

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

export type MentionLink = {
  kind: 'plugin' | 'skill'
  label: string
}

export function classifyMentionLink(label: string, href?: string, options: { allowMissingPluginHref?: boolean } = {}): MentionLink | null {
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

export function MentionPill({ mention }: { mention: MentionLink }) {
  const Icon = mention.kind === 'plugin' ? Plug : Package
  return (
    <span className={MENTION_PILL_CLASS} data-mention-kind={mention.kind}>
      <Icon className="h-[0.9em] w-[0.9em] shrink-0" />
      <span className="min-w-0 truncate">{mention.label}</span>
    </span>
  )
}

export function formatInlineCodexText(text: string): ReactNode[] {
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

export { CODE_INLINE_CLASS }
