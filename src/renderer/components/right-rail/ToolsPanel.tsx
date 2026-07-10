import { AlertCircle, CheckCircle2, Clock3, Copy, Info, Loader2, MessageSquare, PlugZap, ShieldQuestion, Wrench, XCircle } from 'lucide-react'
import { useCodexWindows } from '../../state/codex'
import { useRecentToolEvents, useToolRegistry, type ToolTimelineEvent } from '../../state/tools'
import { cn } from '../../lib/ui'
import { createSendChatContextEvent } from '../chat/chat-context-events'
import { createCodexResourceContextCapturedEvent } from '../codex-resource-context-events'
import { createToolEventContextCapturedEvent } from '../tool-event-context-events'
import { toolRegistryChatContext } from '../codex-resources'
import { toolEventChatContext } from '../tool-chat-context'
import type { ToolEventStatus, ToolRegistrySnapshot } from '@/shared/tools'
import { toolRegistryCapabilityMessages, toolRegistryVisibleErrors } from './tool-registry-model'

const STATUS_LABELS: Record<ToolEventStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  progress: 'Progress',
  approval_requested: 'Approval',
  approved: 'Approved',
  denied: 'Denied',
  completed: 'Completed',
  failed: 'Failed',
  disabled: 'Disabled',
}

function statusClass(status: ToolEventStatus): string {
  switch (status) {
    case 'completed':
    case 'approved':
      return 'text-app-success'
    case 'failed':
    case 'denied':
      return 'text-app-danger'
    case 'approval_requested':
      return 'text-app-warning'
    case 'running':
    case 'progress':
      return 'text-app-info'
    case 'disabled':
      return 'text-app-text-muted'
    default:
      return 'text-app-text-muted'
  }
}

function StatusIcon({ status }: { status: ToolEventStatus }) {
  const className = cn('h-3.5 w-3.5', statusClass(status))
  switch (status) {
    case 'completed':
    case 'approved':
      return <CheckCircle2 className={className} />
    case 'failed':
    case 'denied':
      return <XCircle className={className} />
    case 'approval_requested':
      return <ShieldQuestion className={className} />
    case 'running':
      return <Loader2 className={cn(className, 'animate-spin')} />
    case 'progress':
      return <Info className={className} />
    case 'disabled':
      return <AlertCircle className={className} />
    default:
      return <Clock3 className={className} />
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventPreview(event: ToolTimelineEvent): string | null {
  return event.error ?? event.resultPreview ?? event.argumentsPreview ?? null
}

function eventMeta(event: ToolTimelineEvent): string {
  const bits: string[] = [event.kind]
  if (event.durationMs !== undefined && event.durationMs !== null) bits.push(`${Math.round(event.durationMs)}ms`)
  if (event.reviewId) bits.push(`review ${event.reviewId.slice(0, 8)}`)
  return bits.join(' · ')
}

function ToolRow({ event }: { event: ToolTimelineEvent }) {
  const preview = eventPreview(event)
  const sendContextToChat = () => {
    window.dispatchEvent(createToolEventContextCapturedEvent(event))
    window.dispatchEvent(createSendChatContextEvent({ text: toolEventChatContext(event) }))
  }
  const copyContext = () => {
    window.dispatchEvent(createToolEventContextCapturedEvent(event))
    navigator.clipboard.writeText(toolEventChatContext(event)).catch((error) => console.error('Failed to copy tool event context:', error))
  }

  return (
    <li className="border-b border-app-border px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <StatusIcon status={event.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-app-text" title={event.name}>
              {event.title ?? event.name}
            </span>
            <span className={cn('shrink-0 text-micro font-medium uppercase', statusClass(event.status))}>
              {STATUS_LABELS[event.status]}
            </span>
            <button
              type="button"
              className="ml-auto shrink-0 rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent"
              title="Send tool event context to chat"
              aria-label="Send tool event context to chat"
              onClick={sendContextToChat}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent"
              title="Copy tool event context"
              aria-label="Copy tool event context"
              onClick={copyContext}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-micro text-app-text-muted">
            <span>{formatTime(event.timestamp)}</span>
            <span className="truncate">{eventMeta(event)}</span>
          </div>
          {preview && (
            <pre className={cn(
              'mt-1 max-h-20 overflow-hidden whitespace-pre-wrap break-words rounded bg-app-surface-2 px-2 py-1 text-micro leading-4 text-app-text-muted',
              event.error ? 'text-app-danger' : '',
            )}>
              {preview}
            </pre>
          )}
        </div>
      </div>
    </li>
  )
}

function RegistrySection({ registry, isLoading }: { registry: ToolRegistrySnapshot | undefined; isLoading: boolean }) {
  const apps = registry?.apps ?? []
  const mcpServers = registry?.mcpServers ?? []
  const enabledApps = apps.filter((app) => app.enabled)
  const errors = toolRegistryVisibleErrors(registry)
  const capabilityMessages = toolRegistryCapabilityMessages(registry)

  return (
    <section className="border-b border-app-border">
      <div className="grid grid-cols-3 border-b border-app-border text-center text-micro text-app-text-muted">
        <div className="border-r border-app-border py-2">
          <div className="text-sm font-semibold text-app-text">{apps.length}</div>
          <div>apps</div>
        </div>
        <div className="border-r border-app-border py-2">
          <div className="text-sm font-semibold text-app-text">{mcpServers.length}</div>
          <div>MCP</div>
        </div>
        <div className="py-2">
          <div className="text-sm font-semibold text-app-text">{mcpServers.reduce((sum, server) => sum + server.toolCount, 0)}</div>
          <div>tools</div>
        </div>
      </div>
      {isLoading ? (
        <div className="px-3 py-2 text-xs text-app-text-muted">Loading registry...</div>
      ) : errors.length ? (
        <div className="space-y-1 px-3 py-2 text-xs text-app-danger">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
      {capabilityMessages.length > 0 && (
        <div className="space-y-2 border-b border-app-border px-3 py-2">
          {capabilityMessages.map((message) => (
            <div key={message.id} className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1.5">
              <div className="text-xs font-medium text-amber-200">{message.title}</div>
              <div className="mt-0.5 text-micro leading-4 text-app-text-muted">{message.description}</div>
            </div>
          ))}
        </div>
      )}
      {enabledApps.length > 0 && (
        <div className="border-b border-app-border px-3 py-2">
          <div className="mb-1 text-micro font-medium uppercase text-app-text-muted">Apps</div>
          <div className="flex flex-wrap gap-1.5">
            {enabledApps.slice(0, 12).map((app) => (
              <span key={app.id} className="rounded bg-app-surface-2 px-1.5 py-0.5 text-micro text-app-text">
                {app.name}
              </span>
            ))}
            {enabledApps.length > 12 && (
              <span className="rounded bg-app-surface-2 px-1.5 py-0.5 text-micro text-app-text-muted">
                +{enabledApps.length - 12}
              </span>
            )}
          </div>
        </div>
      )}
      {mcpServers.length > 0 && (
        <div className="divide-y divide-app-border">
          {mcpServers.slice(0, 6).map((server) => (
            <div key={server.name} className="px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-app-text">{server.name}</span>
                <span className="text-micro text-app-text-muted">{server.authStatus}</span>
                <span className="text-micro text-app-text-muted">{server.toolCount}</span>
              </div>
              {server.tools.length > 0 && (
                <div className="mt-1 truncate text-micro text-app-text-muted">
                  {server.tools.slice(0, 5).map((tool) => tool.title ?? tool.name).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!isLoading && !apps.length && !mcpServers.length && !errors.length && !capabilityMessages.length && (
        <div className="px-3 py-2 text-xs text-app-text-muted">No app or MCP registry entries.</div>
      )}
    </section>
  )
}

export function ToolsPanel() {
  const { activeThreadId } = useCodexWindows()
  const { data: events = [], isLoading } = useRecentToolEvents()
  const { data: registry, isLoading: registryLoading } = useToolRegistry(activeThreadId)
  const newestFirst = [...events].reverse()
  const runningCount = events.filter((event) => event.status === 'running' || event.status === 'progress').length
  const failedCount = events.filter((event) => event.status === 'failed' || event.status === 'denied').length
  const sendRegistryContextToChat = () => {
    if (!registry) return
    const text = toolRegistryChatContext(registry)
    window.dispatchEvent(createCodexResourceContextCapturedEvent({
      kind: 'tool-registry',
      label: 'Codex tool registry',
      text,
    }))
    window.dispatchEvent(createSendChatContextEvent({ text }))
  }
  const copyRegistryContext = () => {
    if (!registry) return
    const text = toolRegistryChatContext(registry)
    window.dispatchEvent(createCodexResourceContextCapturedEvent({
      kind: 'tool-registry',
      label: 'Codex tool registry',
      text,
    }))
    navigator.clipboard.writeText(text).catch((error) => console.error('Failed to copy tool registry context:', error))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-app-border px-3 text-caption text-app-text-muted">
        <span className="flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" />
          {events.length}
        </span>
        <span>{runningCount} active</span>
        <span>{failedCount} failed</span>
        <span className="ml-auto flex items-center gap-1.5">
          <PlugZap className="h-3.5 w-3.5" />
          observe-only
        </span>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-app-accent"
          title="Send tool registry context to chat"
          aria-label="Send tool registry context to chat"
          disabled={!registry}
          onClick={sendRegistryContextToChat}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-app-text-muted hover:bg-app-surface hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-app-accent"
          title="Copy tool registry context"
          aria-label="Copy tool registry context"
          disabled={!registry}
          onClick={copyRegistryContext}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RegistrySection registry={registry} isLoading={registryLoading} />
        <div className="px-3 py-2 text-micro font-medium uppercase text-app-text-muted">Timeline</div>
        {isLoading ? (
          <div className="px-3 pb-3 text-sm text-app-text-muted">Loading tool events...</div>
        ) : newestFirst.length ? (
          <ul className="border-t border-app-border">
            {newestFirst.map((event) => (
              <ToolRow key={`${event.telemetryId}:${event.eventId}`} event={event} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-app-text-muted">
            <Wrench className="h-7 w-7 opacity-60" />
            <div>No tool events yet.</div>
          </div>
        )}
      </div>
    </div>
  )
}
