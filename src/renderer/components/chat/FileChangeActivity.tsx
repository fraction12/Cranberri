import type { CodexActivityItemStatus, CodexFileChangeActivityDetail, CodexSdkFileChange } from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import { ActivityDisclosure, ActivityPayload, activityPreview, hasActivityValue } from './ActivityDisclosure'

function patchStats(changes: CodexSdkFileChange[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of changes) {
    if (typeof change.diff !== 'string') continue
    for (const line of change.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1
      if (line.startsWith('-') && !line.startsWith('---')) removed += 1
    }
  }
  return { added, removed }
}

export function FileChangeActivity({ detail, status }: { detail: CodexFileChangeActivityDetail; status: CodexActivityItemStatus }) {
  const changes = Array.isArray(detail.changes) ? detail.changes : []
  const failed = status === 'failed' || status === 'declined' || hasActivityValue(detail.error)
  const stats = patchStats(changes)
  const fileLabel = changes.length === 1 ? '1 file' : `${changes.length} files`
  const title = failed ? 'File change failed' : changes.length > 0 ? `Changed ${fileLabel}` : 'No file changes'
  const preview = changes.map((change) => change.path?.trim()).filter(Boolean).join(', ')
  const meta = changes.length > 0 ? `+${stats.added} -${stats.removed}` : undefined
  const hasDetails = changes.length > 0 || hasActivityValue(detail.applyStatus) || hasActivityValue(detail.error)

  return (
    <ActivityDisclosure
      title={title}
      preview={preview ? activityPreview(preview) : undefined}
      meta={meta}
      failed={failed}
      emptyLabel={!hasDetails ? 'Nothing changed' : undefined}
    >
      {hasDetails ? (
        <>
          {changes.map((change, index) => {
            const path = change.path?.trim() || `File ${index + 1}`
            return (
              <section key={`${path}-${index}`} className="min-w-0" aria-label={path}>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className={`${typeStyle({ role: 'code', tone: 'secondary' })} min-w-0 truncate`}>{path}</span>
                  {hasActivityValue(change.kind) && <span className={typeStyle({ role: 'status', tone: 'tertiary' })}>{activityPreview(change.kind, 48)}</span>}
                </div>
                {hasActivityValue(change.diff) && (
                  <pre className={`${typeStyle({ role: 'code', tone: 'secondary' })} mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-app-surface-2/45 px-2 py-1.5`}>{change.diff}</pre>
                )}
              </section>
            )
          })}
          <ActivityPayload label="Apply status" value={detail.applyStatus} danger={failed} />
          <ActivityPayload label="Error" value={detail.error} danger />
        </>
      ) : undefined}
    </ActivityDisclosure>
  )
}
