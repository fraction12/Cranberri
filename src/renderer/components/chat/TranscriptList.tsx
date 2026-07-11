import { ReasoningGroup, TranscriptMessage } from './Transcript'
import { renderSkillText } from './composer-text'
import { memo, type ReactNode } from 'react'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexMessage, CodexSkillInfo, CodexThread } from '@/shared/codex'

function isVisibleSystemError(message: CodexMessage): boolean {
  return message.role === 'system' && /^Error:/i.test(message.content.trim())
}

function belongsInReasoningGroup(message: CodexMessage): boolean {
  return message.role === 'reasoning' || (message.role === 'system' && !isVisibleSystemError(message))
}

function CompactMessage({ message }: { message: CodexMessage }) {
  const isPending = message.pending ?? false
  const isError = !isPending && /^Compaction failed:/i.test(message.content.trim())
  const [muted, bright] = isPending
    ? ['Compacting', '…']
    : message.content === 'Context compacted'
      ? ['', 'compacted']
      : ['', message.content]

  return (
    <div className="flex justify-center">
      <div
        role={isError ? 'alert' : undefined}
        className={cn(
          typeStyle({ role: 'status', tone: isError ? 'danger' : 'secondary' }),
          'flex items-center gap-2 rounded-full bg-app-surface/70 px-2.5 py-1',
        )}
      >
        {isPending && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--app-text-muted)] opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--app-text-muted)]" />
          </span>
        )}
        {!isPending && <span className="h-2 w-2 rounded-full bg-[var(--app-text-muted)]" />}
        {muted && <span>{muted}</span>}
        <span className={isError ? undefined : 'text-app-text'}>{bright}</span>
      </div>
    </div>
  )
}

export const TranscriptList = memo(function TranscriptList({
  thread,
  skills,
  expandedGroupIds,
  onToggleGroup,
}: {
  thread: CodexThread | undefined
  skills: CodexSkillInfo[]
  expandedGroupIds: Set<string>
  onToggleGroup: (key: string) => void
}) {
  const nodes: ReactNode[] = []
  let reasoningBuffer: CodexMessage[] = []
  let reasoningBufferStartIndex = -1
  let renderedRunningGroup = false
  const isRunning = thread?.isRunning ?? false
  const messages = thread?.messages ?? []
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
  const latestReasoningGroupStartIndex = messages.reduce((latest, message, index) => (
    belongsInReasoningGroup(message) && (index === 0 || !belongsInReasoningGroup(messages[index - 1]))
      ? index
      : latest
  ), -1)

  const renderWorkingGroup = (key = 'working') => {
    renderedRunningGroup = true
    const expanded = expandedGroupIds.has(key) || isRunning
    nodes.push(
      <ReasoningGroup
        key={key}
        messages={[]}
        expanded={expanded}
        onToggle={() => onToggleGroup(key)}
        isRunning={isRunning}
        activity={thread?.currentActivity}
        durationMs={thread?.lastRunDurationMs}
        runStartedAt={thread?.runStartedAt}
        renderSkillText={renderSkillText}
      />,
    )
  }

  const flushReasoning = () => {
    if (reasoningBuffer.length === 0) return
    const group = reasoningBuffer
    const isLatestTurnGroup = lastUserIndex !== -1
      && reasoningBufferStartIndex > lastUserIndex
      && reasoningBufferStartIndex === latestReasoningGroupStartIndex
    const groupIsRunning = isRunning && isLatestTurnGroup
    if (groupIsRunning) renderedRunningGroup = true
    reasoningBuffer = []
    reasoningBufferStartIndex = -1
    const key = `reasoning-${group[0].id}`
    const expanded = expandedGroupIds.has(key) || groupIsRunning
    nodes.push(
      <ReasoningGroup
        key={key}
        messages={group}
        expanded={expanded}
        onToggle={() => onToggleGroup(key)}
        isRunning={groupIsRunning}
        activity={thread?.currentActivity}
        durationMs={isLatestTurnGroup ? thread?.lastRunDurationMs : undefined}
        runStartedAt={thread?.runStartedAt}
        renderSkillText={renderSkillText}
      />,
    )
  }

  const hasRunningReasoning = isRunning && lastUserIndex !== -1 && messages
    .slice(lastUserIndex + 1)
    .some((message) => message.role === 'reasoning' || message.role === 'system')

  messages.forEach((message, index) => {
    if (belongsInReasoningGroup(message)) {
      if (reasoningBuffer.length === 0) reasoningBufferStartIndex = index
      reasoningBuffer.push(message)
      return
    }
    flushReasoning()
    if (isRunning && index === lastUserIndex && !renderedRunningGroup && !hasRunningReasoning) {
      nodes.push(<TranscriptMessage key={message.id} msg={message} skills={skills} renderSkillText={renderSkillText} />)
      renderWorkingGroup(`working-after-${message.id}`)
      return
    }
    if (message.role === 'compact') {
      nodes.push(<CompactMessage key={message.id} message={message} />)
      return
    }
    nodes.push(<TranscriptMessage key={message.id} msg={message} skills={skills} renderSkillText={renderSkillText} />)
  })
  flushReasoning()

  if (isRunning && !renderedRunningGroup) {
    renderWorkingGroup()
  }

  return <>{nodes}</>
})
