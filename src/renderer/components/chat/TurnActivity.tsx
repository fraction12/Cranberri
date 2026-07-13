import { ChevronDown, CircleCheck, CircleStop, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { InlineApproval } from './InlineApproval'
import { InlineUserRequest, InlineUserRequestOutcome } from './InlineUserRequest'
import { TurnActivityItem } from './TurnActivityItem'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexActivityTurn, CodexMessage, PendingApproval } from '@/shared/codex'
import type { CodexHumanServerRequestResponse, CodexPendingHumanServerRequest, CodexRequestOutcomeEntry } from '@/shared/codex-requests'

function turnDurationSeconds(turn: CodexActivityTurn, now: number): number {
  const duration = turn.durationMs ?? Math.max(0, (turn.completedAt ?? now) - turn.startedAt)
  return turn.status === 'running' ? Math.max(0, Math.floor(duration / 1000)) : Math.max(1, Math.round(duration / 1000))
}

export function TurnActivity({
  turn,
  messages,
  approvals,
  humanRequests,
  humanRequestOutcomes,
  resolvingApprovalId,
  onResolveApproval,
  onRespondHumanRequest,
}: {
  turn: CodexActivityTurn
  messages: CodexMessage[]
  approvals: PendingApproval[]
  humanRequests?: CodexPendingHumanServerRequest[]
  humanRequestOutcomes?: CodexRequestOutcomeEntry[]
  resolvingApprovalId?: string | null
  onResolveApproval?: (approvalId: string, decision: 'approve' | 'deny') => void
  onRespondHumanRequest?: (response: CodexHumanServerRequestResponse) => Promise<void>
}) {
  const running = turn.status === 'running'
  const autoExpanded = running || turn.status === 'failed' || approvals.length > 0 || Boolean(humanRequests?.length)
  const [expanded, setExpanded] = useState(autoExpanded)
  const [now, setNow] = useState(turn.completedAt ?? turn.startedAt)
  const wasAutoExpanded = useRef(autoExpanded)

  useEffect(() => {
    if (autoExpanded !== wasAutoExpanded.current) setExpanded(autoExpanded)
    wasAutoExpanded.current = autoExpanded
  }, [autoExpanded])

  useEffect(() => {
    if (!running) return undefined
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [running])

  const seconds = turnDurationSeconds(turn, now)
  const label = running
    ? `Working · ${seconds}s`
    : turn.status === 'completed'
      ? `Worked for ${seconds}s`
      : `${turn.status === 'failed' ? 'Failed' : 'Stopped'} after ${seconds}s`
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const itemIds = new Set(turn.items.map((item) => item.id))
  const fallbackApprovals = approvals.filter((approval) => !approval.targetItemId || !itemIds.has(approval.targetItemId))
  const requestItemId = (pending: CodexPendingHumanServerRequest): string | null => (
    pending.request.method === 'mcpServer/elicitation/request' ? null : pending.request.params.itemId
  )
  const fallbackHumanRequests = (humanRequests ?? []).filter((pending) => {
    const itemId = requestItemId(pending)
    return !itemId || !itemIds.has(itemId)
  })

  return (
    <section data-turn-activity={turn.id} className="max-w-full">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={cn(
          typeStyle({ role: 'status', tone: turn.status === 'failed' ? 'danger' : 'secondary' }),
          'group flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-app-surface-2/45 hover:text-app-text',
        )}
      >
        {running ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        ) : turn.status === 'completed' ? (
          <CircleCheck className="h-3.5 w-3.5" />
        ) : (
          <CircleStop className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-fast', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-2.5 py-1 pl-1.5">
          {turn.items.length === 0 && (
            <div className={typeStyle({ role: 'body', tone: 'secondary' })}>Working</div>
          )}
          {turn.items.map((item) => (
            <TurnActivityItem
              key={item.id}
              item={item}
              message={messageById.get(item.id)}
              approvals={approvals.filter((approval) => approval.targetItemId === item.id)}
              humanRequests={(humanRequests ?? []).filter((pending) => requestItemId(pending) === item.id)}
              resolvingApprovalId={resolvingApprovalId}
              onResolveApproval={onResolveApproval}
              onRespondHumanRequest={onRespondHumanRequest}
            />
          ))}
          {fallbackApprovals.map((approval) => (
            <InlineApproval
              key={approval.id}
              approval={approval}
              resolving={Boolean(resolvingApprovalId)}
              onResolve={onResolveApproval}
            />
          ))}
          {fallbackHumanRequests.map((pending) => (
            <InlineUserRequest
              key={`${typeof pending.request.id}:${String(pending.request.id)}`}
              pending={pending}
              onRespond={onRespondHumanRequest}
            />
          ))}
          {humanRequestOutcomes?.map((outcome) => (
            <InlineUserRequestOutcome
              key={`${outcome.method}:${typeof outcome.requestId}:${String(outcome.requestId)}`}
              outcome={outcome}
            />
          ))}
        </div>
      )}
    </section>
  )
}
