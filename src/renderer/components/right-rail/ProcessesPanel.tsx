import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createCloseProcessTerminalEvent, createOpenProcessTerminalEvent } from '../process-terminal-events'
import type { AgentProcessInfo } from '@/shared/processes'

interface ProcessesPanelProps {
  repoPath: string | null
}

const processRowClassName =
  'group flex w-full items-start gap-2 rounded-lg bg-app-surface/70 p-2 text-xs transition hover:bg-app-surface-2'
const terminateButtonClassName =
  'rounded p-1 text-app-text-muted opacity-70 hover:bg-app-border hover:text-app-danger disabled:cursor-wait disabled:opacity-40 group-hover:opacity-100'

export function ProcessesPanel({ repoPath }: ProcessesPanelProps) {
  const [processes, setProcesses] = useState<AgentProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminatingId, setTerminatingId] = useState<string | null>(null)

  const handleTerminate = async (processInfo: AgentProcessInfo) => {
    if (!repoPath || terminatingId) return
    const command = processInfo.command || processInfo.id
    if (!window.confirm(`Terminate process "${command}" (pid ${processInfo.pid})?`)) return
    setTerminatingId(processInfo.id)
    setError(null)
    setProcesses((items) => items.filter((item) => item.id !== processInfo.id))
    try {
      await window.cranberri.processes.terminate(repoPath, processInfo.id)
      if (processInfo.kind === 'terminal' && processInfo.terminalWindowId) {
        window.dispatchEvent(createCloseProcessTerminalEvent(processInfo))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close process')
      const result = await window.cranberri.processes.list(repoPath)
      setProcesses(result.processes)
    } finally {
      setTerminatingId(null)
    }
  }

  useEffect(() => {
    if (!repoPath) {
      setProcesses([])
      return
    }

    let cancelled = false
    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true)
      try {
        const result = await window.cranberri.processes.list(repoPath)
        if (!cancelled) {
          setProcesses(result.processes)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load processes')
      } finally {
        if (!cancelled && showLoading) setLoading(false)
      }
    }

    load(true).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load processes'))
    const interval = window.setInterval(() => {
      load(false).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load processes'))
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [repoPath])

  if (!repoPath) {
    return <div className="p-3 text-sm text-app-text-muted">Select a repo to inspect running processes.</div>
  }

  if (error) {
    return <div className="p-3 text-sm text-app-danger">{error}</div>
  }

  return (
    <div className="h-[calc(100%-2rem)] overflow-y-auto p-2">
      {loading && processes.length === 0 && (
        <div className="p-2 text-xs text-app-text-muted">Scanning repo processes...</div>
      )}
      {!loading && processes.length === 0 && (
        <div className="p-2 text-xs text-app-text-muted">No running processes found for this repo.</div>
      )}
      <div className="space-y-1">
        {processes.map((processInfo) => (
          <ProcessRow
            key={processInfo.id}
            processInfo={processInfo}
            terminating={terminatingId === processInfo.id}
            onTerminate={handleTerminate}
          />
        ))}
      </div>
    </div>
  )
}

function ProcessRow({
  processInfo,
  terminating,
  onTerminate,
}: {
  processInfo: AgentProcessInfo
  terminating: boolean
  onTerminate: (processInfo: AgentProcessInfo) => void
}) {
  const openTerminal = () => {
    window.dispatchEvent(createOpenProcessTerminalEvent(processInfo))
  }

  return (
    <div className={processRowClassName}>
      <button
        type="button"
        onClick={openTerminal}
        className="min-w-0 flex-1 text-left focus:outline-none focus:ring-1 focus:ring-app-accent"
        title="Open in terminal"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">
            {processInfo.kind}
          </span>
          <span className="text-[10px] text-app-text-muted">pid {processInfo.pid}</span>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-app-text" title={processInfo.command}>
          {processInfo.command}
        </div>
        {processInfo.cwd && (
          <div className="mt-1 truncate text-[10px] text-app-text-muted" title={processInfo.cwd}>
            {processInfo.cwd}
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={() => void onTerminate(processInfo)}
        disabled={terminating}
        className={terminateButtonClassName}
        title="Close process"
        aria-label="Close process"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
