import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { WindowRecoveryNotice as WindowRecoveryNoticeModel } from '../../state/recovery'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export function StartupRecoveryNotice({ notice }: { notice: WindowRecoveryNoticeModel }) {
  const attention = notice.blocksMutations
  return (
    <div
      role={attention ? 'alert' : 'status'}
      data-startup-recovery={notice.status}
      className={cn(
        'mx-auto mt-3 flex w-[calc(100%-2.5rem)] max-w-[780px] items-start gap-2.5 rounded-md px-3 py-2.5',
        attention ? 'bg-app-status-warning/10' : 'bg-app-surface-2/70',
      )}
    >
      {attention
        ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-app-status-warning" aria-hidden="true" />
        : <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-app-text-secondary" aria-hidden="true" />}
      <div className="min-w-0">
        <div className={typeStyle({ role: 'status', tone: attention ? 'warning' : 'primary' })}>{notice.title}</div>
        <div className={cn('mt-0.5', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{notice.description}</div>
      </div>
    </div>
  )
}
