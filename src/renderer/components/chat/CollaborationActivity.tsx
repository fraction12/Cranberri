import type { CodexActivityItemStatus, CodexCollaborationActivityDetail } from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import { ActivityDisclosure, ActivityPayload, activityPreview, hasActivityValue } from './ActivityDisclosure'

export function CollaborationActivity({ detail, status }: { detail: CodexCollaborationActivityDetail; status: CodexActivityItemStatus }) {
  const receiverIds = Array.isArray(detail.receiverThreadIds) ? detail.receiverThreadIds.filter(Boolean) : []
  const states = detail.agentsStates && typeof detail.agentsStates === 'object' ? detail.agentsStates : {}
  const agentIds = Array.from(new Set([...receiverIds, ...Object.keys(states)]))
  const failed = status === 'failed' || status === 'declined'
  const count = agentIds.length
  const title = failed
    ? 'Collaboration failed'
    : status === 'running'
      ? `Running ${count || 'a'} collaborator${count === 1 ? '' : 's'}`
      : count > 0
        ? `Updated ${count} collaborator${count === 1 ? '' : 's'}`
        : 'Collaboration completed'
  const hasDetails = count > 0
    || Boolean(detail.senderThreadId || detail.tool || detail.model || detail.reasoningEffort)
    || hasActivityValue(detail.prompt)

  return (
    <ActivityDisclosure
      title={title}
      preview={hasActivityValue(detail.prompt) ? activityPreview(detail.prompt) : undefined}
      status={detail.tool || undefined}
      failed={failed}
      emptyLabel={!hasDetails ? 'No collaboration details' : undefined}
    >
      {hasDetails ? (
        <>
          <ActivityPayload label="Prompt" value={detail.prompt} />
          {(detail.senderThreadId || detail.model || detail.reasoningEffort) && (
            <div className={`${typeStyle({ role: 'metadata', tone: 'tertiary' })} flex flex-wrap gap-x-3 gap-y-1`}>
              {detail.senderThreadId && <span>From {detail.senderThreadId}</span>}
              {detail.model && <span>Model {detail.model}</span>}
              {detail.reasoningEffort && <span>Reasoning {detail.reasoningEffort}</span>}
            </div>
          )}
          {agentIds.length > 0 && (
            <section aria-label="Collaborators">
              <div className={typeStyle({ role: 'micro', tone: 'tertiary' })}>Collaborators</div>
              <ul className="mt-1 space-y-1.5">
                {agentIds.map((agentId) => {
                  const agent = states[agentId]
                  return (
                    <li key={agentId} className="min-w-0 px-1 py-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className={`${typeStyle({ role: 'code', tone: 'secondary' })} min-w-0 flex-1 truncate`}>{agentId}</span>
                        <span className={typeStyle({ role: 'status', tone: agent?.status === 'failed' ? 'danger' : 'tertiary' })}>{agent?.status || 'Status unavailable'}</span>
                      </div>
                      {agent?.message && <div className={`${typeStyle({ role: 'metadata', tone: 'secondary' })} mt-0.5 break-words`}>{agent.message}</div>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      ) : undefined}
    </ActivityDisclosure>
  )
}
