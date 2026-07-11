import type { FormEvent } from 'react'
import { ArrowUpRight, Loader2, MessageSquare, Send, Square } from 'lucide-react'
import type { CodexWorker } from '@/shared/codex'
import { codexWorkerIsActive } from '@/shared/codex-workers'
import { AgentStatusIcon, agentDisplayName, agentStatusLabel } from './agent-presentation'
import { buttonStyle, cn, compactFieldStyle, iconButton } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface AgentRowProps {
  agent: CodexWorker
  selected: boolean
  stopping: boolean
  messageOpen: boolean
  message: string
  busy: boolean
  error: string | null
  onToggle: () => void
  onToggleMessage: () => void
  onMessageChange: (message: string) => void
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void
  onStop: () => void
  onOpen: () => void
}

export function AgentRow({
  agent,
  selected,
  stopping,
  messageOpen,
  message,
  busy,
  error,
  onToggle,
  onToggleMessage,
  onMessageChange,
  onSubmitMessage,
  onStop,
  onOpen,
}: AgentRowProps) {
  const name = agentDisplayName(agent)
  const active = codexWorkerIsActive(agent.status)
  const summary = agent.message || [agent.model, agent.reasoningEffort].filter(Boolean).join(' · ') || agent.role || 'No recent activity'
  const statusTone = stopping
    ? 'warning'
    : agent.status === 'completed'
      ? 'success'
      : agent.status === 'errored' || agent.status === 'notFound'
        ? 'danger'
        : active
          ? 'info'
          : 'secondary'

  return (
    <article className={cn('rounded-md transition-colors duration-fast ease-standard', selected ? 'bg-app-surface-2/65' : 'hover:bg-app-bg/70')}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        aria-label={`View ${name}`}
        aria-expanded={selected}
        data-worker-id={agent.threadId}
        data-worker-status={agent.status}
      >
        <AgentStatusIcon status={agent.status} stopping={stopping} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate', typeStyle({ role: 'label' }))}>{name}</span>
            {agent.role && <span className={cn('truncate', typeStyle({ role: 'micro', tone: 'secondary' }))}>{agent.role}</span>}
          </span>
          <span className={cn('mt-0.5 block truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))} title={summary}>{summary}</span>
        </span>
        <span className={cn('shrink-0', typeStyle({ role: 'status', tone: statusTone }))}>{stopping ? 'Stopping' : agentStatusLabel(agent.status)}</span>
      </button>

      {selected && (
        <div className="space-y-2 px-2.5 pb-2.5 pl-8" data-worker-detail={agent.threadId}>
          <div className="flex justify-end">
            <div className="flex items-center gap-0.5">
              {agent.status !== 'notFound' && (
                <button
                  type="button"
                  onClick={onToggleMessage}
                  className={iconButton()}
                  title={active ? 'Steer agent' : 'Resume agent'}
                  aria-label={active ? `Steer ${name}` : `Resume ${name}`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              )}
              {active && (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopping}
                  className={iconButton({ tone: 'danger' })}
                  title="Stop agent"
                  aria-label={`Stop ${name}`}
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={onOpen}
                className={iconButton()}
                title="Open agent task"
                aria-label={`Open ${name}`}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {messageOpen && (
            <form className="flex items-center gap-2" onSubmit={onSubmitMessage}>
              <input
                autoFocus
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                placeholder={active ? 'Steer this agent...' : 'Resume with a new instruction...'}
                className={cn(compactFieldStyle, 'flex-1 bg-app-surface')}
              />
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className={buttonStyle({ tone: 'primary', size: 'icon' })}
                aria-label="Send agent instruction"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </form>
          )}
          {error && <div className={cn('[overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))}>{error}</div>}
        </div>
      )}
    </article>
  )
}
