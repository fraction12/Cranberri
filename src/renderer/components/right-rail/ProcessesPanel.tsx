import { useEffect, useState } from 'react'
import { Globe, MessageSquare, Terminal, X } from 'lucide-react'
import { createOpenProcessBrowserEvent } from '../process-browser-events'
import { createCloseProcessTerminalEvent, createOpenProcessTerminalEvent } from '../process-terminal-events'
import { createSendChatContextEvent } from '../chat/chat-context-events'
import { createProcessContextCapturedEvent } from '../process-context-events'
import { processChatContext } from '../process-chat-context'
import { canFocusProcessTerminal, processRowMetadata } from './process-row-model'
import { ConfirmDialog } from '../ConfirmDialog'
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
  const [terminateTarget, setTerminateTarget] = useState<AgentProcessInfo | null>(null)

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
      await window.cranberri.processes.terminate(repoPath, processInfo.id)
      if (processInfo.kind === 'terminal' && processInfo.terminalWindowId) {
        window.dispatchEvent(createCloseProcessTerminalEvent(processInfo))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close process')
      const result = await window.cranberri.processes.list(repoPath)
      setProcesses(result.processes)
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
  onTerminate,
}: {
  processInfo: AgentProcessInfo
  terminating: boolean
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
    window.dispatchEvent(createSendChatContextEvent({ text: processChatContext(processInfo) }))
  }
  const canFocusTerminal = canFocusProcessTerminal(processInfo)
  const metadata = processRowMetadata(processInfo)

  return (
    <div className={processRowClassName}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-micro uppercase text-app-text-muted">
            {processInfo.kind}
          </span>
          <span className="text-micro text-app-text-muted">{processInfo.id}</span>
        </div>
        <div className="mt-1 truncate font-mono text-caption text-app-text" title={processInfo.command}>
          {processInfo.command}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {metadata.map((item) => (
            <span key={item} className="rounded bg-app-bg px-1.5 py-0.5 text-micro text-app-text-muted">
              {item}
            </span>
          ))}
        </div>
        {processInfo.cwd && (
          <div className="mt-1 truncate text-micro text-app-text-muted" title={processInfo.cwd}>
            {processInfo.cwd}
          </div>
        )}
      </div>
      {canFocusTerminal && (
        <button
          type="button"
          onClick={openTerminal}
          className="rounded p-1 text-app-text-muted opacity-70 hover:bg-app-border hover:text-app-text group-hover:opacity-100"
          title="Focus process terminal"
          aria-label="Focus process terminal"
        >
          <Terminal className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={sendContextToChat}
        className="rounded p-1 text-app-text-muted opacity-70 hover:bg-app-border hover:text-app-text group-hover:opacity-100"
        title="Send process context to chat"
        aria-label="Send process context to chat"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      {processInfo.kind === 'dev-server' && (
        <button
          type="button"
          onClick={openBrowser}
          className="rounded p-1 text-app-text-muted opacity-70 hover:bg-app-border hover:text-app-text group-hover:opacity-100"
          title="Open browser"
          aria-label="Open browser"
        >
          <Globe className="h-3.5 w-3.5" />
        </button>
      )}
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
