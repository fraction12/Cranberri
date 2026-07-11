import { AlertCircle, FileText, Loader2, RefreshCw, X } from 'lucide-react'
import { buttonStyle, cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export type TaskSetupPhase = 'idle' | 'creating' | 'setup' | 'worktreeFailed' | 'setupFailed'
export function TaskSetupStatus({ phase, onRetry, onCancel, onInspect }: { phase: TaskSetupPhase; onRetry?: () => void; onCancel?: () => void; onInspect?: () => void }) {
  if (phase === 'idle') return null
  const busy = phase === 'creating' || phase === 'setup'
  const label = phase === 'creating' ? 'Creating worktree...' : phase === 'setup' ? 'Setting up environment...' : phase === 'worktreeFailed' ? 'Worktree creation failed' : 'Environment setup failed'
  return <div role="status" aria-live="polite" className="flex min-h-9 items-center gap-2 rounded-md bg-app-surface-2/55 px-2.5"><span className={cn('flex min-w-0 flex-1 items-center gap-2', typeStyle({ role: 'status', tone: busy ? 'secondary' : 'danger' }))}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}<span className="truncate">{label}</span></span>{!busy && onRetry && <button type="button" className={buttonStyle({ tone: 'ghost', size: 'compact' })} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Retry</button>}{onInspect && <button type="button" className={buttonStyle({ tone: 'ghost', size: 'icon' })} aria-label={phase === 'setupFailed' ? 'View setup logs' : 'View diagnostics'} title={phase === 'setupFailed' ? 'View setup logs' : 'View diagnostics'} onClick={onInspect}><FileText className="h-3.5 w-3.5" /></button>}{busy && onCancel && <button type="button" className={buttonStyle({ tone: 'ghost', size: 'icon' })} aria-label="Cancel setup" title="Cancel setup" onClick={onCancel}><X className="h-3.5 w-3.5" /></button>}</div>
}
