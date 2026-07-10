import { useCallback } from 'react'
import { Loader2, Pin, PinOff } from 'lucide-react'
import type { ToolCatalogEntry, ToolCatalogId } from '@/shared/tools'
import { iconButton } from '../../lib/ui'
import { ToolRow } from '../right-rail/tool-row'

interface CatalogToolRowProps {
  entry: ToolCatalogEntry
  expanded: boolean
  testing: boolean
  pinning: boolean
  onExpandedChange: (toolId: ToolCatalogId, expanded: boolean) => void
  onTest: (toolId: ToolCatalogId) => void
  onOpenSettings: (toolId: ToolCatalogId) => void
  onPinChange: (toolId: ToolCatalogId, pinned: boolean) => void
  onSendDiagnostic?: (toolId: ToolCatalogId) => void
}

export function CatalogToolRow({
  entry,
  expanded,
  testing,
  pinning,
  onExpandedChange,
  onTest,
  onOpenSettings,
  onPinChange,
  onSendDiagnostic,
}: CatalogToolRowProps) {
  const togglePin = useCallback(() => onPinChange(entry.id, !entry.inRail), [entry.id, entry.inRail, onPinChange])
  const pinLabel = entry.inRail ? `Unpin ${entry.name} from Tools rail` : `Pin ${entry.name} to Tools rail`
  const pinAction = (
    <button
      type="button"
      className={iconButton({ tone: entry.inRail ? 'active' : 'neutral' })}
      disabled={pinning}
      aria-label={pinning ? `${pinLabel} in progress` : pinLabel}
      aria-pressed={entry.inRail}
      title={pinLabel}
      onClick={togglePin}
    >
      {pinning
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : entry.inRail ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
    </button>
  )
  return (
    <ToolRow
      entry={entry}
      expanded={expanded}
      busy={testing}
      endAction={pinAction}
      onExpandedChange={onExpandedChange}
      onTest={onTest}
      onOpenSettings={onOpenSettings}
      onSendDiagnostic={onSendDiagnostic}
    />
  )
}
