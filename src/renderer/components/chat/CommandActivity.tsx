import type { CodexActivityItemStatus, CodexCommandActivityDetail, CodexSdkCommandAction } from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import {
  ActivityDisclosure,
  ActivityPayload,
  activityPreview,
  formatActivityDuration,
  hasActivityValue,
} from './ActivityDisclosure'

function actionLabel(action: CodexSdkCommandAction, index: number): string {
  return action.name?.trim() || action.command?.trim() || action.query?.trim() || action.type?.trim() || `Action ${index + 1}`
}

export function CommandActivity({ detail, status }: { detail: CodexCommandActivityDetail; status: CodexActivityItemStatus }) {
  const failed = status === 'failed' || status === 'declined' || (typeof detail.exitCode === 'number' && detail.exitCode !== 0)
  const title = failed ? 'Command failed' : status === 'running' ? 'Running command' : 'Command completed'
  const duration = formatActivityDuration(detail.durationMs)
  const exit = typeof detail.exitCode === 'number' ? `Exit ${detail.exitCode}` : null
  const meta = [exit, duration].filter(Boolean).join(' · ') || undefined
  const actions = Array.isArray(detail.commandActions) ? detail.commandActions : []
  const command = detail.command?.trim()
  const hasDetails = Boolean(command)
    || actions.length > 0
    || hasActivityValue(detail.cwd)
    || hasActivityValue(detail.aggregatedOutput)
    || Boolean(detail.processId || detail.source)

  return (
    <ActivityDisclosure
      title={title}
      status={status === 'declined' ? 'Declined' : undefined}
      preview={command ? activityPreview(command) : undefined}
      meta={meta}
      failed={failed}
      emptyLabel={!hasDetails ? 'No command details' : undefined}
    >
      {hasDetails ? (
        <>
          <ActivityPayload label="Command" value={command} />
          {actions.length > 0 && (
            <section aria-label="Command actions">
              <div className={typeStyle({ role: 'micro', tone: 'tertiary' })}>Actions</div>
              <ul className="mt-1 space-y-1">
                {actions.map((action, index) => (
                  <li key={`${actionLabel(action, index)}-${index}`} className="flex min-w-0 items-baseline gap-2">
                    <span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{actionLabel(action, index)}</span>
                    {action.path !== undefined && <span className={`${typeStyle({ role: 'code', tone: 'tertiary' })} min-w-0 truncate`}>{activityPreview(action.path)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ActivityPayload label="Working directory" value={detail.cwd} />
          {(detail.processId || detail.source) && (
            <div className={`${typeStyle({ role: 'metadata', tone: 'tertiary' })} flex flex-wrap gap-x-3 gap-y-1`}>
              {detail.processId && <span>Process {detail.processId}</span>}
              {detail.source && <span>Source {detail.source}</span>}
            </div>
          )}
          <ActivityPayload label="Output" value={detail.aggregatedOutput} danger={failed} />
        </>
      ) : undefined}
    </ActivityDisclosure>
  )
}
