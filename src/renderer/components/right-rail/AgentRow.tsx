import type { FormEvent } from 'react'
import { ArrowUpRight, Loader2, MessageSquare, Send, Square } from 'lucide-react'
import type { CodexWorker } from '@/shared/codex'
import { codexWorkerIsActive } from '@/shared/codex-workers'
import { AgentStatusIcon, agentDisplayName, agentStatusLabel } from './agent-presentation'

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

  return (
    <article className={`rounded-md ${selected ? 'bg-app-bg' : 'hover:bg-app-bg/60'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left"
        aria-label={`View ${name}`}
        aria-expanded={selected}
        data-worker-id={agent.threadId}
        data-worker-status={agent.status}
      >
        <AgentStatusIcon status={agent.status} stopping={stopping} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-app-text">{name}</span>
            {agent.role && <span className="truncate text-micro text-app-text-muted">{agent.role}</span>}
          </span>
          <span className="mt-0.5 block truncate text-caption text-app-text-muted" title={summary}>{summary}</span>
        </span>
        <span className="shrink-0 text-micro text-app-text-muted">{stopping ? 'Stopping' : agentStatusLabel(agent.status)}</span>
      </button>

      {selected && (
        <div className="space-y-2 px-3 pb-3 pl-8" data-worker-detail={agent.threadId}>
          <div className="flex justify-end">
            <div className="flex items-center gap-0.5">
              {agent.status !== 'notFound' && (
                <button
                  type="button"
                  onClick={onToggleMessage}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
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
                  className="flex h-7 w-7 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-danger disabled:opacity-40"
                  title="Stop agent"
                  aria-label={`Stop ${name}`}
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={onOpen}
                className="flex h-7 w-7 items-center justify-center rounded-md text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
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
                className="h-8 min-w-0 flex-1 rounded-md border border-app-border bg-app-surface px-2 text-xs text-app-text outline-none focus:border-app-text-muted"
              />
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-app-text text-app-bg disabled:opacity-40"
                aria-label="Send agent instruction"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </form>
          )}
          {error && <div className="text-xs text-app-danger">{error}</div>}
        </div>
      )}
    </article>
  )
}
