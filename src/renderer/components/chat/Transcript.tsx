import { Suspense, lazy, memo, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, MessageSquarePlus } from 'lucide-react'
import { formatInlineCodexText } from './mention-pill'
import { createSendChatContextEvent } from './chat-context-events'
import { assistantResponseChatContext, stripCodexAppDirectives } from './assistant-response-context'
import type { CodexMessage, CodexSkillInfo } from '@/shared/codex'

type SkillRenderer = (text: string, skills: CodexSkillInfo[]) => ReactNode[]
const MarkdownContent = lazy(() => import('./MarkdownContent').then((module) => ({ default: module.MarkdownContent })))
const PING_DOT_CLASS = 'absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40'
const USER_BUBBLE_CLASS = [
  'max-w-[76%] rounded-2xl bg-[var(--app-surface)] px-2.5 py-1.5',
  'text-sm leading-5 text-[var(--app-text)]',
  'shadow-[inset_0_0_0_1px_var(--app-inset)]',
].join(' ')

function MessageActions({ text }: { text: string }) {
  const visibleText = stripCodexAppDirectives(text)
  if (!visibleText) return null
  const sendToChat = () => {
    window.dispatchEvent(createSendChatContextEvent({
      text: assistantResponseChatContext(visibleText),
    }))
  }

  return (
    <div className="mt-4 flex items-center gap-3 text-[var(--app-text-muted)] opacity-80">
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(visibleText).catch((error) => console.error('Failed to copy response:', error))}
        className="rounded p-0.5 hover:text-[var(--app-text)]"
        aria-label="Copy response"
        title="Copy response"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={sendToChat}
        className="rounded p-0.5 hover:text-[var(--app-text)]"
        aria-label="Send response to chat"
        title="Send response to chat"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
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
      <div role="alert" className="border-l-2 border-app-danger bg-app-danger/5 px-3 py-2 text-sm leading-5 text-app-danger">
        <div className="whitespace-pre-wrap">{formatInlineCodexText(msg.content)}</div>
      </div>
    )
  }

  if (msg.role === 'system' || msg.role === 'reasoning') {
    return (
      <div className="max-w-full text-sm leading-5 text-[var(--app-text-muted)]">
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
    <article className="max-w-full text-base leading-7 text-[var(--app-text)]">
      <div className="break-words">
        <Suspense fallback={<div className="whitespace-pre-wrap text-sm leading-5">{formatInlineCodexText(fallbackText)}</div>}>
          <MarkdownContent text={msg.content} hideAppDirectives streaming={msg.pending} />
        </Suspense>
      </div>
      {!msg.pending && <MessageActions text={msg.content} />}
    </article>
  )
})
