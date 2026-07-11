import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CornerUpLeft, Network } from 'lucide-react'
import type { CodexThread, CodexWorker } from '@/shared/codex'
import { codexWorkerIsActive } from '@/shared/codex-workers'
import { AgentRow } from './AgentRow'
import { agentDisplayName, agentStatusLabel } from './agent-presentation'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface AgentListProps {
  thread: CodexThread | null
  onOpenAgent: (agent: CodexWorker) => void
  onOpenParent: (parentThreadId: string) => void
  onMessageAgent: (agent: CodexWorker, content: string) => Promise<void>
  onStopAgent: (agent: CodexWorker) => Promise<void>
}

export { agentDisplayName, agentStatusLabel }

export function AgentList({ thread, onOpenAgent, onOpenParent, onMessageAgent, onStopAgent }: AgentListProps) {
  const agents = useMemo(() => sortAgentsNewestFirst(thread?.workers ?? []), [thread?.workers])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busyAgent, setBusyAgent] = useState<string | null>(null)
  const [stoppingAgents, setStoppingAgents] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const activeAgents = agents.filter((agent) => codexWorkerIsActive(agent.status))
  const recentAgents = agents.filter((agent) => !codexWorkerIsActive(agent.status))
  const activeCount = activeAgents.length

  useEffect(() => {
    setSelectedAgentId(null)
    setMessageTarget(null)
    setMessage('')
    setBusyAgent(null)
    setStoppingAgents(new Set())
    setError(null)
  }, [thread?.id])

  useEffect(() => {
    setStoppingAgents((current) => {
      const next = new Set([...current].filter((threadId) => {
        const agent = agents.find((candidate) => candidate.threadId === threadId)
        return agent ? codexWorkerIsActive(agent.status) : false
      }))
      return next.size === current.size ? current : next
    })
  }, [agents])

  const submitMessage = async (event: FormEvent<HTMLFormElement>, agent: CodexWorker) => {
    event.preventDefault()
    const content = message.trim()
    if (!content) return
    setBusyAgent(agent.threadId)
    setError(null)
    try {
      await onMessageAgent(agent, content)
      setMessage('')
      setMessageTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to message agent.')
    } finally {
      setBusyAgent(null)
    }
  }

  const stopAgent = async (agent: CodexWorker) => {
    setStoppingAgents((current) => new Set(current).add(agent.threadId))
    setError(null)
    try {
      await onStopAgent(agent)
    } catch (cause) {
      setStoppingAgents((current) => {
        const next = new Set(current)
        next.delete(agent.threadId)
        return next
      })
      setError(cause instanceof Error ? cause.message : 'Failed to stop agent.')
    }
  }

  const renderAgent = (agent: CodexWorker) => (
    <AgentRow
      key={agent.threadId}
      agent={agent}
      selected={selectedAgentId === agent.threadId}
      stopping={stoppingAgents.has(agent.threadId)}
      messageOpen={messageTarget === agent.threadId}
      message={messageTarget === agent.threadId ? message : ''}
      busy={busyAgent === agent.threadId}
      error={selectedAgentId === agent.threadId ? error : null}
      onToggle={() => {
        setSelectedAgentId((current) => current === agent.threadId ? null : agent.threadId)
        setMessageTarget(null)
        setMessage('')
        setError(null)
      }}
      onToggleMessage={() => {
        setMessageTarget((current) => current === agent.threadId ? null : agent.threadId)
        setMessage('')
        setError(null)
      }}
      onMessageChange={setMessage}
      onSubmitMessage={(event) => void submitMessage(event, agent)}
      onStop={() => void stopAgent(agent)}
      onOpen={() => onOpenAgent(agent)}
    />
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-app-surface" data-agents-panel="true">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
        <span className={typeStyle({ role: 'panelTitle' })}>Task agents</span>
        <span className={typeStyle({ role: 'status', tone: activeCount > 0 ? 'info' : 'secondary' })}>{activeCount > 0 ? `${activeCount} active` : 'None active'}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!thread && <EmptyAgents label="No active task" />}

        {thread?.parentThreadId && (
          <div className="mb-3 rounded-md bg-app-surface-2/45 px-3 py-2.5">
            <div className={typeStyle({ role: 'label', tone: 'secondary' })}>Current agent</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className={cn('truncate', typeStyle({ role: 'body' }))}>{thread.agentNickname || thread.title}</div>
                {thread.agentRole && <div className={cn('truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{thread.agentRole}</div>}
              </div>
              <button
                type="button"
                onClick={() => onOpenParent(thread.parentThreadId!)}
                className={cn('flex h-7 items-center gap-1 rounded-md px-2 hover:bg-app-surface-2 hover:text-app-text', typeStyle({ role: 'control', tone: 'secondary' }))}
                aria-label="Open parent task"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
                Parent
              </button>
            </div>
          </div>
        )}

        {thread && agents.length === 0 && !thread.parentThreadId && <EmptyAgents label="No agents in this task" />}
        {activeAgents.length > 0 && <AgentGroup label="Active">{activeAgents.map(renderAgent)}</AgentGroup>}
        {recentAgents.length > 0 && <AgentGroup label="Recent">{recentAgents.map(renderAgent)}</AgentGroup>}
      </div>
    </section>
  )
}

function sortAgentsNewestFirst(agents: ReadonlyArray<CodexWorker>): CodexWorker[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => {
      const startedAt = (right.agent.createdAt ?? right.agent.updatedAt)
        - (left.agent.createdAt ?? left.agent.updatedAt)
      if (startedAt !== 0) return startedAt

      const updatedAt = right.agent.updatedAt - left.agent.updatedAt
      return updatedAt !== 0 ? updatedAt : left.index - right.index
    })
    .map(({ agent }) => agent)
}

function AgentGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className={cn('px-2 pb-1', typeStyle({ role: 'label', tone: 'secondary' }))}>{label}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

function EmptyAgents({ label }: { label: string }) {
  return (
    <div className={cn('flex min-h-48 flex-col items-center justify-center px-4 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
      <Network className="mb-2 h-7 w-7 opacity-50" />
      {label}
    </div>
  )
}
