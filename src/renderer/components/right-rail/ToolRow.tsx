import { useCallback, useId, type ReactNode } from 'react'
import { ChevronRight, Loader2, Settings2, TestTube2 } from 'lucide-react'
import type { ToolCatalogEntry, ToolCatalogId } from '@/shared/tools'
import { cn, iconButton } from '../../lib/ui'
import {
  toolAvailability,
  toolAvailabilityLabel,
  toolMachineContextLabel,
  toolMachineStatusLabel,
  toolSourceDisplayLabel,
  toolTaskStatusLabel,
} from '../../state/tool-catalog-selectors'
import { ToolDetails, toolTimeLabel } from './ToolDetails'

export interface ToolRowProps {
  entry: ToolCatalogEntry
  expanded: boolean
  busy?: boolean
  endAction?: ReactNode
  onExpandedChange: (toolId: ToolCatalogId, expanded: boolean) => void
  onTest: (toolId: ToolCatalogId) => void
  onOpenSettings: (toolId: ToolCatalogId) => void
  onSendDiagnostic?: (toolId: ToolCatalogId) => void
}

export function ToolRow({
  entry,
  expanded,
  busy = false,
  endAction,
  onExpandedChange,
  onTest,
  onOpenSettings,
  onSendDiagnostic,
}: ToolRowProps) {
  const detailsId = useId()
  const availability = toolAvailability(entry)
  const machineLabel = entry.isOrphan ? toolAvailabilityLabel(entry) : toolMachineStatusLabel(entry.machine.status)
  const probeCapable = entry.probeCapability.kind !== 'unsupported'
  const toggleExpanded = useCallback(() => onExpandedChange(entry.id, !expanded), [entry.id, expanded, onExpandedChange])
  const testTool = useCallback(() => onTest(entry.id), [entry.id, onTest])
  const openSettings = useCallback(() => onOpenSettings(entry.id), [entry.id, onOpenSettings])
  const sendDiagnostic = useCallback(() => onSendDiagnostic?.(entry.id), [entry.id, onSendDiagnostic])

  return (
    <article aria-busy={busy || undefined}>
      <div className="grid min-h-[66px] grid-cols-[minmax(0,1fr)_auto] items-start gap-1 px-2 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={toggleExpanded}
          className="min-w-0 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-app-text-muted transition-transform', expanded && 'rotate-90')} />
            <span className="truncate text-xs font-medium text-app-text" title={entry.name}>{entry.name}</span>
            <span className={cn(
              'ml-auto shrink-0 text-micro',
              availability === 'available' && 'text-app-success',
              availability === 'needs-attention' && 'text-app-warning',
              availability === 'unknown' && 'text-app-text-muted',
            )} aria-live="polite">
              {toolAvailabilityLabel(entry)}
            </span>
          </span>
          <span className="mt-1 block truncate pl-5 text-micro text-app-text-muted" title={`${toolMachineContextLabel(entry.source)}: ${machineLabel}; Task: ${toolTaskStatusLabel(entry.task.status)}`}>
            {toolMachineContextLabel(entry.source)}: {machineLabel} · Task: {toolTaskStatusLabel(entry.task.status)}
          </span>
          <span className="mt-0.5 block truncate pl-5 text-micro text-app-text-muted" title={toolSourceDisplayLabel(entry.source)}>
            {toolSourceDisplayLabel(entry.source)} · {entry.machine.version ? `Version ${entry.machine.version.slice(0, 40)}` : 'Version unknown'} · {toolTimeLabel(entry.machine.observedAt, 'Checked')}{entry.machine.stale ? ' · Stale' : ''}
          </span>
        </button>
        <div className="flex items-center gap-0.5">
          {endAction}
          {probeCapable ? (
            <button
              type="button"
              className={iconButton()}
              disabled={busy}
              title="Test tool"
              aria-label={busy ? `Testing ${entry.name}` : `Test ${entry.name}`}
              onClick={testTool}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <button
              type="button"
              className={iconButton()}
              title="Open tool settings"
              aria-label={`Open settings for ${entry.name}`}
              onClick={openSettings}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div id={detailsId} role="region" aria-label={`${entry.name} details`} hidden={!expanded}>
        {expanded && <ToolDetails entry={entry} onSend={onSendDiagnostic ? sendDiagnostic : undefined} />}
      </div>
    </article>
  )
}
