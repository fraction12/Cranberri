import { MessageSquare } from 'lucide-react'
import type { ToolCatalogEntry } from '@/shared/tools'
import { cn } from '../../lib/ui'
import {
  toolAvailability,
  toolAvailabilityLabel,
  toolSourceDisplayLabel,
} from '../../state/tool-catalog-selectors'

const ACTIVITY_LABELS: Record<NonNullable<ToolCatalogEntry['activity']>['outcome'], string> = {
  started: 'Running now',
  succeeded: 'Used successfully',
  failed: 'Failed',
  denied: 'Denied',
  'authentication-required': 'Sign-in required',
  'approval-required': 'Waiting for approval',
}

function timeLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function activityLabel(activity: NonNullable<ToolCatalogEntry['activity']>): string {
  const parts = [ACTIVITY_LABELS[activity.outcome], timeLabel(activity.observedAt)]
  if (activity.durationMs !== null) parts.push(`${Math.round(activity.durationMs)} ms`)
  return parts.filter(Boolean).join(' · ')
}

function nextStep(entry: ToolCatalogEntry): string | null {
  if (entry.isOrphan) return 'Reconnect the provider or hide this tool from the rail.'
  if (entry.machine.status === 'missing' && entry.source.kind === 'cli') {
    return `Install ${entry.name}, then refresh tool status.`
  }
  if (entry.machine.status === 'authentication-required') {
    return `Sign in to ${entry.name}, then check it again.`
  }
  if (entry.machine.status === 'disconnected') return 'Reconnect this provider in Apps settings.'
  if (entry.machine.status === 'unknown') return 'Refresh after checking the app PATH and tool permissions.'
  if (entry.task.status === 'denied') return 'Change the task permissions before using this tool.'
  return null
}

export function ToolDetails({ entry, divided = true, onSend }: { entry: ToolCatalogEntry; divided?: boolean; onSend?: () => void }) {
  const attention = toolAvailability(entry) === 'needs-attention'
  const checkedAt = timeLabel(entry.machine.observedAt)
  const remediation = nextStep(entry)
  const canSend = Boolean(onSend && (entry.machine.diagnosticCode || attention))

  return (
    <div className={cn('bg-app-bg/45 px-8 py-3 text-caption text-app-text-muted', divided ? 'border-t border-app-border' : 'mx-2 mb-2 rounded-md')}>
      <p className="text-xs leading-5 text-app-text">{entry.description}</p>
      <dl className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>Status</dt>
        <dd className="text-app-text">{toolAvailabilityLabel(entry)}</dd>
        <dt>Source</dt>
        <dd className="truncate text-app-text" title={toolSourceDisplayLabel(entry.source)}>
          {toolSourceDisplayLabel(entry.source)}
        </dd>
        {entry.machine.version && (
          <>
            <dt>Version</dt>
            <dd className="truncate font-mono text-app-text">{entry.machine.version}</dd>
          </>
        )}
        {checkedAt && (
          <>
            <dt>Checked</dt>
            <dd className="text-app-text">{checkedAt}{entry.machine.stale ? ' · Refresh needed' : ''}</dd>
          </>
        )}
        {entry.activity && (
          <>
            <dt>Recent use</dt>
            <dd className="text-app-text">{activityLabel(entry.activity)}</dd>
          </>
        )}
        {remediation && (
          <>
            <dt>Next step</dt>
            <dd className="text-app-text">{remediation}</dd>
          </>
        )}
      </dl>
      {canSend && (
        <button
          type="button"
          className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-caption text-app-text-muted hover:bg-app-surface-2 hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
          onClick={onSend}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Send status to chat
        </button>
      )}
    </div>
  )
}
