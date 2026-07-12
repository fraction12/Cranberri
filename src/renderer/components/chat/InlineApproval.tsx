import { Check, X } from 'lucide-react'
import { buttonStyle, cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { PendingApproval } from '@/shared/codex'

export function InlineApproval({
  approval,
  resolving,
  onResolve,
}: {
  approval: PendingApproval
  resolving: boolean
  onResolve?: (approvalId: string, decision: 'approve' | 'deny') => void
}) {
  return (
    <div className="mt-2 border-l-2 border-app-warning/45 py-1 pl-3" data-turn-approval={approval.id}>
      <div className={typeStyle({ role: 'status', tone: 'warning' })}>Approval needed</div>
      <div className={cn(typeStyle({ role: 'body', tone: 'secondary' }), 'mt-0.5')}>{approval.description}</div>
      {onResolve && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onResolve(approval.id, 'approve')}
            disabled={resolving}
            className={buttonStyle({ tone: 'primary', size: 'small' })}
          >
            <Check className="h-3 w-3" /> Approve
          </button>
          <button
            type="button"
            onClick={() => onResolve(approval.id, 'deny')}
            disabled={resolving}
            className={buttonStyle({ tone: 'secondary', size: 'small' })}
          >
            <X className="h-3 w-3" /> Deny
          </button>
        </div>
      )}
    </div>
  )
}
