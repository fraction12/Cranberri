import { AlertCircle, CheckCircle2, Loader2, Power } from 'lucide-react'
import type { CodexWorker, CodexWorkerStatus } from '@/shared/codex'
import { codexWorkerIsActive } from '@/shared/codex-workers'

const STATUS_LABELS: Record<CodexWorkerStatus, string> = {
  pendingInit: 'Starting',
  running: 'Running',
  idle: 'Idle',
  interrupted: 'Stopped',
  completed: 'Completed',
  errored: 'Failed',
  shutdown: 'Closed',
  notFound: 'Not found',
}

export function agentDisplayName(agent: CodexWorker): string {
  return agent.nickname || agent.title || agent.role || `Agent ${agent.threadId.slice(0, 8)}`
}

export function agentStatusLabel(status: CodexWorkerStatus): string {
  return STATUS_LABELS[status]
}

export function AgentStatusIcon({ status, stopping = false }: { status: CodexWorkerStatus; stopping?: boolean }) {
  if (stopping) return <Loader2 className="h-3.5 w-3.5 animate-spin text-app-warning" aria-hidden="true" />
  if (codexWorkerIsActive(status)) return <Loader2 className="h-3.5 w-3.5 animate-spin text-app-accent" aria-hidden="true" />
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-app-success" aria-hidden="true" />
  if (status === 'errored' || status === 'notFound') return <AlertCircle className="h-3.5 w-3.5 text-app-danger" aria-hidden="true" />
  return <Power className="h-3.5 w-3.5 text-app-text-muted" aria-hidden="true" />
}
