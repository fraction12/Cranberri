import { useCallback, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Settings2, Wrench } from 'lucide-react'
import type { ToolCatalogId } from '@/shared/tools'
import { useCodexWindows } from '../../state/codex'
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
import { iconButton } from '../../lib/ui'
import { createSendChatContextEvent } from '../chat/chat-context-events'
import { ToolGroup } from './tool-group'
import { ToolRow } from './tool-row'

interface ToolsPanelProps {
  onOpenSettings: () => void
}

export function ToolsPanel({ onOpenSettings }: ToolsPanelProps) {
  const { activeThreadId } = useCodexWindows()
  const { windows, activeWindowId } = useWorkspace()
  const { settings } = useSettings()
  const catalogThreadId = codexThreadIdForActiveWindow(windows, activeWindowId, activeThreadId)
  const catalog = useToolCatalog(catalogThreadId)
  const [expandedToolId, setExpandedToolId] = useState<ToolCatalogId | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
    setActionError(null)
    try {
      await action()
    } catch {
      setActionError('Tool action failed. Try again or open Settings.')
    }
  }, [])

  const sendDiagnostic = useCallback((toolId: ToolCatalogId) => {
    const entry = catalogById.get(toolId)
    if (!entry) return
    const draft = toolDiagnosticDraft(entry)
    if (!window.confirm(`Add this metadata-only diagnostic to the active chat draft?\n\n${draft}`)) return
    window.dispatchEvent(createSendChatContextEvent({ text: draft }))
  }, [catalogById])

  const statusLabel = catalog.isLoading && !catalog.data
    ? 'Checking tools'
    : [
        `${readyCount} ready`,
        actionCount ? `${actionCount} action${actionCount === 1 ? '' : 's'}` : null,
        catalog.data?.refresh.status === 'stale' ? 'refresh needed' : null,
      ].filter(Boolean).join(' · ')
  const refreshFailure = catalog.data?.refresh.status === 'failed'
    ? `Tools unavailable${catalog.data.refresh.errorCode ? ` (${catalog.data.refresh.errorCode.slice(0, 80)})` : ''}.`
    : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-app-border px-2 text-caption text-app-text-muted">
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
      {(actionError || refreshFailure || (catalog.isError && !catalog.data)) && (
        <div className="shrink-0 border-b border-app-danger/30 px-3 py-2 text-caption text-app-danger" role="alert">
          {actionError ?? refreshFailure ?? 'Tools unavailable. Try refreshing or open Settings.'}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {catalog.isLoading && !catalog.data ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-app-text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking tools...
          </div>
        ) : groups.length ? groups.map((group) => (
          <ToolGroup key={group.source} label={group.label}>
            {group.entries.map((entry) => (
              <ToolRow
                key={entry.id}
                entry={entry}
                expanded={expandedToolId === entry.id}
                busy={catalog.testingToolIds.includes(entry.id)}
                onExpandedChange={(toolId, expanded) => setExpandedToolId(expanded ? toolId : null)}
                onTest={(toolId) => void runAction(() => catalog.testTool(toolId))}
                onOpenSettings={onOpenSettings}
                onSendDiagnostic={sendDiagnostic}
              />
            ))}
          </ToolGroup>
        )) : (
          <div className="px-3 py-5 text-center text-xs text-app-text-muted">No tools in this rail. Choose them in Settings.</div>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{catalog.refreshing ? 'Refreshing tool health.' : ''}</div>
    </div>
  )
}
