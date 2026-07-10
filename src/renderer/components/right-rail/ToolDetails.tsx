import { MessageSquare } from 'lucide-react'
import type { ToolCatalogEntry } from '@/shared/tools'
import { iconButton } from '../../lib/ui'
import { toolAvailability } from '../../state/tool-catalog-selectors'

const ACTIVITY_LABELS: Record<NonNullable<ToolCatalogEntry['activity']>['outcome'], string> = {
  started: 'Started',
  succeeded: 'Succeeded',
  failed: 'Failed',
  denied: 'Denied',
  'authentication-required': 'Authentication required',
  'approval-required': 'Approval required',
}

export function toolTimeLabel(value: string | null, prefix: string): string {
  if (!value) return `${prefix} unavailable`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return `${prefix} unavailable`
  return `${prefix} ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

function activityLabel(activity: NonNullable<ToolCatalogEntry['activity']>): string {
  const parts = [ACTIVITY_LABELS[activity.outcome], toolTimeLabel(activity.observedAt, 'at')]
  if (activity.durationMs !== null) parts.push(`${Math.round(activity.durationMs)} ms`)
  if (activity.callId) parts.push(`call ${activity.callId.slice(0, 12)}`)
  return parts.join(' · ')
}

function probeLabel(entry: ToolCatalogEntry): string {
  if (entry.probeCapability.kind === 'automatic') return 'Automatic safe check'
  const prefix = entry.probeCapability.kind === 'manual-only' ? 'Manual safe check' : 'No safe check'
  return `${prefix}: ${entry.probeCapability.reason.slice(0, 120)}`
}

export function ToolDetails({ entry, onSend }: { entry: ToolCatalogEntry; onSend?: () => void }) {
  const canSend = Boolean(onSend && (entry.machine.diagnosticCode || toolAvailability(entry) === 'needs-attention'))
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 bg-app-bg/40 px-3 py-2 text-micro text-app-text-muted">
      <span>Machine evidence</span>
      <span className="truncate text-app-text">{entry.machine.provenance}</span>
      <span />
      <span>Task evidence</span>
      <span className="truncate text-app-text">{entry.task.provenance}</span>
      <span />
      <span>Check</span>
      <span className="min-w-0 break-words text-app-text">{probeLabel(entry)}</span>
      <span />
      {entry.machine.diagnosticCode && (
        <>
          <span>Diagnostic</span>
          <span className="truncate font-mono text-app-text" title={entry.machine.diagnosticCode}>
            {entry.machine.diagnosticCode.slice(0, 80)}
          </span>
          <span />
        </>
      )}
      {entry.activity && (
        <>
          <span>Recent activity</span>
          <span className="min-w-0 break-words text-app-text">{activityLabel(entry.activity)}</span>
          <span />
        </>
      )}
      {canSend && (
        <>
          <span>Failure context</span>
          <span className="text-app-text">Ready for chat</span>
          <button
            type="button"
            className={iconButton()}
            title="Send failure context to chat"
            aria-label={`Send ${entry.name} failure context to chat`}
            onClick={onSend}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
