import { Suspense, lazy, memo, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, MessageSquarePlus } from 'lucide-react'
import { formatInlineCodexText } from './mention-pill'
import { sendChatContextSafely } from '../../state/chat-context-command'
import { assistantResponseChatContext, stripCodexAppDirectives } from './assistant-response-context'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexMessage, CodexSkillInfo } from '@/shared/codex'
import { IconButton } from '../ui/IconButton'

type SkillRenderer = (text: string, skills: CodexSkillInfo[]) => ReactNode[]
const MarkdownContent = lazy(() => import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })))
const PING_DOT_CLASS = 'absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40'
const USER_BUBBLE_CLASS = cn(
  typeStyle({ role: 'prose', tone: 'primary' }),
  'max-w-[78%] rounded-[14px] bg-app-surface-2/70 px-3 py-2',
)

function MessageActions({ text }: { text: string }) {
  const visibleText = stripCodexAppDirectives(text)
  if (!visibleText) return null
  const sendToChat = () => {
    sendChatContextSafely({
      text: assistantResponseChatContext(visibleText),
    })
  }

  return (
    <div className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-3 flex items-center gap-1 opacity-75')}>
      <IconButton
        type="button"
        onClick={() => navigator.clipboard.writeText(visibleText).catch((error) => console.error('Failed to copy response:', error))}
        label="Copy response"
      >
        <Copy className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        type="button"
        onClick={sendToChat}
        label="Send response to chat"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
      </IconButton>
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
    <div className={cn(typeStyle({ role: 'body', tone: 'secondary' }), 'max-w-full')}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          typeStyle({ role: 'status', tone: 'secondary' }),
          'mb-1 flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-app-surface-2/55 hover:text-app-text',
        )}
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
        <div className="space-y-4 rounded-md bg-app-surface/55 px-3 py-3">
          {messages.map((message) => (
            <TranscriptMessage key={message.id} msg={message} renderSkillText={renderSkillText} />
          ))}
        </div>
      )}
    </div>
  )
}

export const TranscriptMessage = memo(function TranscriptMessage({
  msg,
  skills = [],
  renderSkillText,
}: {
  msg: CodexMessage
  skills?: CodexSkillInfo[]
  renderSkillText: SkillRenderer
}) {
  if (msg.role === 'system' && /^Error:/i.test(msg.content.trim())) {
    return (
      <div
        role="alert"
        className={cn(typeStyle({ role: 'body', tone: 'danger' }), 'rounded-md bg-app-danger/8 px-3 py-2')}
      >
        <div className="whitespace-pre-wrap">{formatInlineCodexText(msg.content)}</div>
      </div>
    )
  }

  if (msg.role === 'system' || msg.role === 'reasoning') {
    return (
      <div
        className={cn(
          typeStyle({ role: 'body', tone: msg.role === 'reasoning' ? 'secondary' : 'tertiary' }),
          'max-w-full',
        )}
      >
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

  const fallbackText = stripCodexAppDirectives(msg.content)

  return (
    <article className={cn(typeStyle({ role: 'prose', tone: 'primary' }), 'group max-w-full')}>
      <div className="break-words">
        <Suspense fallback={<div className="whitespace-pre-wrap">{formatInlineCodexText(fallbackText)}</div>}>
          <MarkdownContent text={msg.content} hideAppDirectives streaming={msg.pending} />
        </Suspense>
      </div>
      {!msg.pending && <MessageActions text={msg.content} />}
    </article>
  )
})
