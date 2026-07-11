import { useCallback, useId, type ReactNode } from 'react'
import { ChevronRight, Loader2, Settings2, TestTube2 } from 'lucide-react'
import type { ToolCatalogEntry, ToolCatalogId } from '@/shared/tools'
import { cn, iconButton } from '../../lib/ui'
import {
  toolAvailability,
  toolAvailabilityLabel,
} from '../../state/tool-catalog-selectors'
import { ToolDetails } from './tool-details'

export interface ToolRowProps {
  entry: ToolCatalogEntry
  expanded: boolean
  busy?: boolean
  endAction?: ReactNode
  divided?: boolean
  showDescription?: boolean
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
  divided = true,
  showDescription = true,
  onExpandedChange,
  onTest,
  onOpenSettings,
  onSendDiagnostic,
}: ToolRowProps) {
  const detailsId = useId()
  const availability = toolAvailability(entry)
  const probeCapable = entry.probeCapability.kind !== 'unsupported'
  const toggleExpanded = useCallback(() => onExpandedChange(entry.id, !expanded), [entry.id, expanded, onExpandedChange])
  const testTool = useCallback(() => onTest(entry.id), [entry.id, onTest])
  const openSettings = useCallback(() => onOpenSettings(entry.id), [entry.id, onOpenSettings])
  const sendDiagnostic = useCallback(() => onSendDiagnostic?.(entry.id), [entry.id, onSendDiagnostic])

  return (
    <article aria-busy={busy || undefined} className={cn('group rounded-md transition-colors duration-fast ease-standard', expanded ? 'bg-app-surface-2/60' : 'hover:bg-app-bg/75')}>
      <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 py-1.5', showDescription ? 'min-h-12' : 'min-h-10')}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={toggleExpanded}
          className="min-w-0 rounded-md px-1 py-0.5 text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-app-text-muted transition-transform', expanded && 'rotate-90')} />
            <span className="truncate font-medium text-app-text" title={entry.name}>{entry.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption text-app-text-muted" aria-live="polite">
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                availability === 'available' ? 'bg-app-success' : 'bg-app-warning',
              )} />
              {toolAvailabilityLabel(entry)}
            </span>
          </span>
          {showDescription && entry.description && (
            <span className="mt-0.5 block truncate pl-5 text-caption text-app-text-muted" title={entry.description}>
              {entry.description}
            </span>
          )}
        </button>
        <div className="flex items-center gap-0.5">
          {endAction}
          {probeCapable ? (
            <button
              type="button"
              className={cn(iconButton(), 'opacity-70 group-hover:opacity-100 focus-visible:opacity-100')}
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
              className={cn(iconButton(), 'opacity-70 group-hover:opacity-100 focus-visible:opacity-100')}
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
        {expanded && <ToolDetails entry={entry} divided={divided} onSend={onSendDiagnostic ? sendDiagnostic : undefined} />}
      </div>
    </article>
  )
}
