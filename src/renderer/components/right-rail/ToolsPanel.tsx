import { useCallback, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Settings2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import type { ToolCatalogId } from '@/shared/tools'
import { useSettings } from '../../state/settings'
import { useWorkspace } from '../../state/workspace'
import { codexThreadIdForActiveWindow } from '../../state/workspace-model'
import {
  selectRailToolGroups,
  selectToolEntriesWithPreferences,
  toolAvailability,
} from '../../state/tool-catalog-selectors'
import { toolDiagnosticDraft } from '../../state/tool-diagnostic'
import { useToolCatalog } from '../../state/tools'
import { cn, iconButton } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { createSendChatContextEvent } from '../chat/chat-context-events'
import { ToolGroup } from './tool-group'
import { ToolRow } from './tool-row'

interface ToolsPanelProps {
  onOpenSettings: () => void
}

export function ToolsPanel({ onOpenSettings }: ToolsPanelProps) {
  const { windows, activeWindowId } = useWorkspace()
  const { settings } = useSettings()
  const catalogThreadId = codexThreadIdForActiveWindow(windows, activeWindowId)
  const catalog = useToolCatalog(catalogThreadId)
  const [expandedToolId, setExpandedToolId] = useState<ToolCatalogId | null>(null)
  const entries = useMemo(
    () => selectToolEntriesWithPreferences(catalog.data?.entries ?? [], settings.tools),
    [catalog.data?.entries, settings.tools],
  )
  const groups = useMemo(() => selectRailToolGroups(entries), [entries])
  const railEntries = useMemo(() => groups.flatMap((group) => group.entries), [groups])
  const readyCount = railEntries.filter((entry) => toolAvailability(entry) === 'available').length
  const actionCount = railEntries.length - readyCount
  const catalogById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tool action failed')
    }
  }, [])

  const sendDiagnostic = useCallback((toolId: ToolCatalogId) => {
    const entry = catalogById.get(toolId)
    if (!entry) return
    const draft = toolDiagnosticDraft(entry)
    window.dispatchEvent(createSendChatContextEvent({ text: draft }))
    toast.success(`${entry.name} status added to chat`)
  }, [catalogById])

  const statusLabel = catalog.isLoading && !catalog.data
    ? 'Checking tools'
    : [
        `${readyCount} of ${railEntries.length} ready`,
        actionCount ? `${actionCount} need setup` : null,
        catalog.data?.refresh.status === 'stale' ? 'last verified' : null,
      ].filter(Boolean).join(' · ')
  const refreshFailure = catalog.data?.refresh.status === 'failed'
    ? `Tools unavailable${catalog.data.refresh.errorCode ? ` (${catalog.data.refresh.errorCode.slice(0, 80)})` : ''}.`
    : null
  const statusTone = catalog.isLoading && !catalog.data
    ? 'secondary'
    : actionCount > 0
      ? 'warning'
      : 'success'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-10 shrink-0 items-center gap-2 px-2.5', typeStyle({ role: 'status', tone: statusTone }))}>
        <Wrench className="h-3.5 w-3.5" />
        <span>{statusLabel}</span>
        <button type="button" className={`${iconButton()} ml-auto`} title="Manage tools" aria-label="Manage tools" onClick={onOpenSettings}>
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={iconButton()}
          title="Refresh tool health"
          aria-label="Refresh tool health"
          disabled={catalog.refreshing || catalog.isLoading}
          onClick={() => void runAction(catalog.refresh)}
        >
          {catalog.refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
      {(refreshFailure || (catalog.isError && !catalog.data)) && (
        <div className={cn('mx-2 mb-1 shrink-0 rounded-md bg-app-status-danger/8 px-3 py-2 [overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))} role="alert">
          {refreshFailure ?? 'Tools could not be loaded. Refresh or open Settings.'}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {catalog.isLoading && !catalog.data ? (
          <div className={cn('flex items-center gap-2 px-3 py-4', typeStyle({ role: 'status', tone: 'secondary' }))} role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking tools
          </div>
        ) : groups.length ? groups.map((group) => (
          <ToolGroup key={group.source} label={group.label}>
            {group.entries.map((entry) => (
              <ToolRow
                key={entry.id}
                entry={entry}
                expanded={expandedToolId === entry.id}
                busy={catalog.testingToolIds.includes(entry.id)}
                showDescription={false}
                onExpandedChange={(toolId, expanded) => setExpandedToolId(expanded ? toolId : null)}
                onTest={(toolId) => void runAction(() => catalog.testTool(toolId))}
                onOpenSettings={onOpenSettings}
                onSendDiagnostic={sendDiagnostic}
              />
            ))}
          </ToolGroup>
        )) : (
          <div className={cn('flex h-full min-h-40 flex-col items-center justify-center px-4 text-center', typeStyle({ role: 'body', tone: 'secondary' }))}>
            <Wrench className="mb-2 h-6 w-6 opacity-45" />
            Choose tools in Settings.
          </div>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{catalog.refreshing ? 'Refreshing tool health.' : ''}</div>
    </div>
  )
}
