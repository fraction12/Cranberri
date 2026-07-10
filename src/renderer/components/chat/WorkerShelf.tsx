import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  CornerUpLeft,
  Loader2,
  MessageSquare,
  Network,
  Power,
  Send,
  Square,
} from 'lucide-react'
import type { CodexThread, CodexWorker, CodexWorkerStatus } from '@/shared/codex'
import { codexWorkerIsActive } from '@/shared/codex-workers'

const STATUS_LABELS: Record<CodexWorkerStatus, string> = {
  pendingInit: 'Starting',
  running: 'Running',
  idle: 'Idle',
  interrupted: 'Stopped',
  completed: 'Completed',
  errored: 'Failed',
  shutdown: 'Closed',
  notFound: 'Unavailable',
}

export function workerDisplayName(worker: CodexWorker): string {
  return worker.nickname || worker.title || worker.role || `Worker ${worker.threadId.slice(0, 8)}`
}

export function workerStatusLabel(status: CodexWorkerStatus): string {
  return STATUS_LABELS[status]
}

function statusIcon(status: CodexWorkerStatus) {
  if (codexWorkerIsActive(status)) return <Loader2 className="h-3 w-3 animate-spin text-app-accent" aria-hidden="true" />
  if (status === 'completed') return <CheckCircle2 className="h-3 w-3 text-app-success" aria-hidden="true" />
  if (status === 'errored' || status === 'notFound') return <AlertCircle className="h-3 w-3 text-app-danger" aria-hidden="true" />
  return <Power className="h-3 w-3 text-app-text-muted" aria-hidden="true" />
}

interface WorkerShelfProps {
  thread: CodexThread
  onOpenWorker: (worker: CodexWorker) => void
  onOpenParent: (parentThreadId: string) => void
  onMessageWorker: (worker: CodexWorker, content: string) => Promise<void>
  onStopWorker: (worker: CodexWorker) => Promise<void>
}

export function WorkerShelf({
  thread,
  onOpenWorker,
  onOpenParent,
  onMessageWorker,
  onStopWorker,
}: WorkerShelfProps) {
  const workers = useMemo(() => thread.workers ?? [], [thread.workers])
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busyWorker, setBusyWorker] = useState<string | null>(null)
  const [stoppingWorkers, setStoppingWorkers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.threadId === selectedWorkerId) ?? null,
    [selectedWorkerId, workers],
  )
  const activeCount = workers.filter((worker) => codexWorkerIsActive(worker.status)).length

  useEffect(() => {
    setStoppingWorkers((current) => {
      const next = new Set([...current].filter((threadId) => {
        const worker = workers.find((candidate) => candidate.threadId === threadId)
        return worker ? codexWorkerIsActive(worker.status) : false
      }))
      return next.size === current.size ? current : next
    })
  }, [workers])

  if (!thread.parentThreadId && workers.length === 0) return null

  const submitMessage = async (event: FormEvent, worker: CodexWorker) => {
    event.preventDefault()
    const content = message.trim()
    if (!content) return
    setBusyWorker(worker.threadId)
    setError(null)
    try {
      await onMessageWorker(worker, content)
      setMessage('')
      setMessageTarget(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to message worker.')
    } finally {
      setBusyWorker(null)
    }
  }

  const stopWorker = async (worker: CodexWorker) => {
    setStoppingWorkers((current) => new Set(current).add(worker.threadId))
    setError(null)
    try {
      await onStopWorker(worker)
    } catch (cause) {
      setStoppingWorkers((current) => {
        const next = new Set(current)
        next.delete(worker.threadId)
        return next
      })
      setError(cause instanceof Error ? cause.message : 'Failed to stop worker.')
    }
  }

  return (
    <section className="shrink-0 border-b border-app-border bg-app-surface/70" data-worker-shelf="true">
      <div className="flex h-10 min-w-0 items-center gap-2 px-4">
        {thread.parentThreadId && (
          <>
            <button
              type="button"
              onClick={() => onOpenParent(thread.parentThreadId!)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-app-text-muted hover:text-app-text"
              aria-label="Open parent task"
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
              <span>Parent</span>
            </button>
            <span className="h-4 w-px shrink-0 bg-app-border" />
          </>
        )}
        {workers.length > 0 && (
          <>
            <Network className="h-3.5 w-3.5 shrink-0 text-app-text-muted" />
            <span className="shrink-0 text-xs font-medium text-app-text">Workers</span>
            <span className="shrink-0 text-micro text-app-text-muted">
              {activeCount ? `${activeCount} active` : workers.length}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1" data-worker-list="true">
              {workers.map((worker) => {
                const selected = selectedWorkerId === worker.threadId
                const stopping = stoppingWorkers.has(worker.threadId)
                return (
                  <button
                    key={worker.threadId}
                    type="button"
                    onClick={() => {
                      setSelectedWorkerId((current) => current === worker.threadId ? null : worker.threadId)
                      setMessageTarget(null)
                      setMessage('')
                      setError(null)
                    }}
                    className={`inline-flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded border px-2 text-xs ${selected ? 'border-app-text-muted bg-app-surface-2 text-app-text' : 'border-app-border bg-app-bg/50 text-app-text-muted hover:text-app-text'}`}
                    aria-label={`View ${workerDisplayName(worker)}`}
                    aria-pressed={selected}
                    data-worker-id={worker.threadId}
                    data-worker-status={worker.status}
                  >
                    {stopping ? <Loader2 className="h-3 w-3 animate-spin text-app-warning" /> : statusIcon(worker.status)}
                    <span className="truncate">{workerDisplayName(worker)}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        {workers.length === 0 && thread.parentThreadId && (
          <div className="min-w-0 truncate text-xs text-app-text">
            {thread.agentNickname || thread.title}
            {thread.agentRole && <span className="ml-2 text-app-text-muted">{thread.agentRole}</span>}
          </div>
        )}
      </div>

      {selectedWorker && (
        <div
          className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-t border-app-border/70 px-4 py-2"
          data-worker-detail={selectedWorker.threadId}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-medium text-app-text">{workerDisplayName(selectedWorker)}</span>
              {selectedWorker.role && <span className="truncate text-micro text-app-text-muted">{selectedWorker.role}</span>}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-micro text-app-text-muted">
              <span className="shrink-0">
                {stoppingWorkers.has(selectedWorker.threadId) ? 'Stopping' : workerStatusLabel(selectedWorker.status)}
              </span>
              {selectedWorker.message && <span className="truncate">{selectedWorker.message}</span>}
              {!selectedWorker.message && selectedWorker.model && (
                <span className="truncate">{selectedWorker.model}{selectedWorker.reasoningEffort ? ` · ${selectedWorker.reasoningEffort}` : ''}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {selectedWorker.status !== 'notFound' && (
              <button
                type="button"
                onClick={() => {
                  setMessageTarget((current) => current === selectedWorker.threadId ? null : selectedWorker.threadId)
                  setMessage('')
                  setError(null)
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
                title={codexWorkerIsActive(selectedWorker.status) ? 'Steer worker' : 'Resume worker'}
                aria-label={codexWorkerIsActive(selectedWorker.status) ? `Steer ${workerDisplayName(selectedWorker)}` : `Resume ${workerDisplayName(selectedWorker)}`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            )}
            {codexWorkerIsActive(selectedWorker.status) && (
              <button
                type="button"
                onClick={() => void stopWorker(selectedWorker)}
                disabled={stoppingWorkers.has(selectedWorker.threadId)}
                className="flex h-7 w-7 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-2 hover:text-app-danger disabled:opacity-40"
                title="Stop worker"
                aria-label={`Stop ${workerDisplayName(selectedWorker)}`}
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenWorker(selectedWorker)}
              className="flex h-7 w-7 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
              title="Open worker task"
              aria-label={`Open ${workerDisplayName(selectedWorker)}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {messageTarget === selectedWorker.threadId && (
            <form className="flex w-full items-center gap-2" onSubmit={(event) => void submitMessage(event, selectedWorker)}>
              <input
                autoFocus
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={codexWorkerIsActive(selectedWorker.status) ? 'Steer this worker...' : 'Resume with a new instruction...'}
                className="h-8 min-w-0 flex-1 rounded border border-app-border bg-app-bg px-2 text-xs text-app-text outline-none focus:border-app-text-muted"
              />
              <button
                type="submit"
                disabled={busyWorker === selectedWorker.threadId || !message.trim()}
                className="flex h-8 w-8 items-center justify-center rounded bg-app-text text-app-bg disabled:opacity-40"
                aria-label="Send worker instruction"
              >
                {busyWorker === selectedWorker.threadId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </form>
          )}
          {error && <div className="w-full text-xs text-app-danger">{error}</div>}
        </div>
      )}
    </section>
  )
}
