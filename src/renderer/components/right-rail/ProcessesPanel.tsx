import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Globe, Loader2, MessageSquare, RefreshCw, Terminal, X } from 'lucide-react'
import { toast } from 'sonner'
import { createOpenProcessBrowserEvent } from '../process-browser-events'
import { createCloseProcessTerminalEvent, createOpenProcessTerminalEvent } from '../process-terminal-events'
import { sendChatContextSafely } from '../../state/chat-context-command'
import { createProcessContextCapturedEvent } from '../process-context-events'
import { processChatContext } from '../process-chat-context'
import { canFocusProcessTerminal, processRowMetadata } from './process-row-model'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AgentProcessInfo } from '@/shared/processes'
import { buttonStyle, cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { IconButton } from '../ui/IconButton'

interface ProcessesPanelProps {
  repoPath: string | null
  taskId?: string | null
}

const processRowClassName =
  'group flex w-full items-start gap-1 rounded-md px-2 py-2 transition-colors duration-fast ease-standard hover:bg-app-surface-2/55'

function processStatusTone(status: AgentProcessInfo['status']): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'running') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'unknown') return 'warning'
  return 'secondary'
}

export function ProcessesPanel({ repoPath, taskId }: ProcessesPanelProps) {
  const [processes, setProcesses] = useState<AgentProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [terminatingId, setTerminatingId] = useState<string | null>(null)
  const [terminateTarget, setTerminateTarget] = useState<AgentProcessInfo | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestTerminate = (processInfo: AgentProcessInfo) => {
    if (!repoPath || terminatingId) return
    setTerminateTarget(processInfo)
  }

  const handleTerminate = async () => {
    if (!repoPath || terminatingId || !terminateTarget) return
    const processInfo = terminateTarget
    setTerminatingId(processInfo.id)
    setError(null)
    setProcesses((items) => items.filter((item) => item.id !== processInfo.id))
    try {
      if (taskId) await window.cranberri.processes.terminateForTask(taskId, processInfo.id)
      else await window.cranberri.processes.terminate(repoPath, processInfo.id)
      if (processInfo.kind === 'terminal' && processInfo.terminalWindowId) {
        window.dispatchEvent(createCloseProcessTerminalEvent(processInfo))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close process')
      try {
        const result = taskId
          ? await window.cranberri.processes.listForTask(taskId)
          : await window.cranberri.processes.list(repoPath)
        setProcesses(result.processes)
      } catch (reloadError) {
        setError(reloadError instanceof Error ? reloadError.message : 'Failed to reload processes')
      }
    } finally {
      setTerminateTarget(null)
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
        const result = taskId
          ? await window.cranberri.processes.listForTask(taskId)
          : await window.cranberri.processes.list(repoPath)
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
  }, [reloadKey, repoPath, taskId])

  if (!repoPath) {
    return <ProcessEmpty label="Select a repo to inspect running processes." />
  }

  if (error && processes.length === 0) {
    return (
      <div role="alert" className="flex h-full min-h-40 flex-col items-center justify-center p-5 text-center">
        <AlertCircle className="mb-2 h-7 w-7 text-app-status-danger" />
        <span className={cn('max-w-full [overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))}>{error}</span>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={cn('mt-2 inline-flex items-center gap-1.5 hover:underline', typeStyle({ role: 'control' }))}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {error && processes.length > 0 && (
        <div className={cn('mb-2 flex items-center gap-2 rounded-md bg-app-status-warning/7 px-2.5 py-2', typeStyle({ role: 'status', tone: 'warning' }))} role="status" title={error}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Process list may be out of date.</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={buttonStyle({ tone: 'ghost', size: 'compact' })}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      )}
      {loading && processes.length === 0 && (
        <div className={cn('flex items-center gap-2 p-2', typeStyle({ role: 'status', tone: 'secondary' }))}><Loader2 className="h-4 w-4 animate-spin" />Scanning repo processes</div>
      )}
      {!loading && processes.length === 0 && (
        <ProcessEmpty label="No running processes." />
      )}
      <div className="space-y-1">
        {processes.map((processInfo) => (
          <ProcessRow
            key={processInfo.id}
            processInfo={processInfo}
            terminating={terminatingId === processInfo.id}
            stale={Boolean(error)}
            onTerminate={requestTerminate}
          />
        ))}
      </div>
      {terminateTarget && (
        <ConfirmDialog
          title="Terminate process"
          description={`Terminate process "${terminateTarget.command || terminateTarget.id}" (pid ${terminateTarget.pid})?`}
          confirmLabel="Terminate"
          busyLabel="Terminating..."
          busy={terminatingId === terminateTarget.id}
          danger
          onCancel={() => {
            if (terminatingId) return
            setTerminateTarget(null)
          }}
          onConfirm={() => {
            void handleTerminate()
          }}
        />
      )}
    </div>
  )
}

function ProcessRow({
  processInfo,
  terminating,
  stale,
  onTerminate,
}: {
  processInfo: AgentProcessInfo
  terminating: boolean
  stale: boolean
  onTerminate: (processInfo: AgentProcessInfo) => void
}) {
  const openTerminal = () => {
    window.dispatchEvent(createOpenProcessTerminalEvent(processInfo))
  }
  const openBrowser = () => {
    window.dispatchEvent(createOpenProcessBrowserEvent(processInfo))
  }
  const sendContextToChat = () => {
    window.dispatchEvent(createProcessContextCapturedEvent(processInfo))
    sendChatContextSafely({ text: processChatContext(processInfo) })
  }
  const canFocusTerminal = canFocusProcessTerminal(processInfo)
  const metadata = processRowMetadata(processInfo)
  const [, ...supportingMetadata] = metadata

  return (
    <div className={processRowClassName}>
      <div className="min-w-0 flex-1">
        <div className={cn('[overflow-wrap:anywhere]', typeStyle({ role: 'metadata' }))} title={processInfo.command}>
          {processInfo.command}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('capitalize', typeStyle({ role: 'status', tone: processStatusTone(processInfo.status) }))}>{processInfo.status}</span>
          <span className={cn('capitalize', typeStyle({ role: 'micro', tone: 'secondary' }))}>{processInfo.kind}</span>
          {supportingMetadata.map((item) => <span key={item} className={typeStyle({ role: 'micro', tone: 'secondary' })}>{item}</span>)}
        </div>
        {processInfo.cwd && (
          <div className={cn('mt-1 [overflow-wrap:anywhere]', typeStyle({ role: 'metadata', tone: 'secondary' }))} title={processInfo.cwd}>
            {processInfo.cwd}
          </div>
        )}
      </div>
      {canFocusTerminal && (
        <IconButton
          type="button"
          onClick={openTerminal}
          className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
          label="Focus process terminal"
        >
          <Terminal className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton
        type="button"
        onClick={sendContextToChat}
        className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
        label="Send process context to chat"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </IconButton>
      {processInfo.kind === 'dev-server' && (
        <IconButton
          type="button"
          onClick={openBrowser}
          className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
          label="Open browser"
        >
          <Globe className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton
        type="button"
        onClick={() => void onTerminate(processInfo)}
        disabled={terminating || stale}
        tone={'danger'} className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
        label={stale ? 'Refresh the process list before closing' : 'Close process'}
      >
        <X className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  )
}

function ProcessEmpty({ label }: { label: string }) {
  return (
    <div className={cn('flex h-full min-h-40 flex-col items-center justify-center p-5 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
      <Activity className="mb-2 h-7 w-7 opacity-45" />
      {label}
    </div>
  )
}
