import { useCallback, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import type {
  ToolCatalogEntry,
  ToolCatalogId,
  ToolCatalogPreferences,
  ToolCatalogSnapshot,
} from '@/shared/tools'
import { cn, iconButton } from '../../lib/ui'
import { ToolGroup } from '../right-rail/ToolGroup'
import { CatalogToolRow } from './CatalogToolRow'
import { ToolCatalogState } from './ToolCatalogState'
import {
  TOOL_CATALOG_FILTER_OPTIONS,
  selectToolCatalogSettingsGroups,
  type ToolCatalogFilter,
} from './tool-catalog-settings-model'

export interface ToolCatalogSettingsProps {
  entries: readonly ToolCatalogEntry[]
  preferences: ToolCatalogPreferences
  loading?: boolean
  refreshing?: boolean
  refreshStatus?: ToolCatalogSnapshot['refresh']['status']
  refreshErrorCode?: string | null
  testingToolIds?: readonly string[]
  pinningToolIds?: readonly string[]
  pinError?: string | null
  onRefresh?: () => void
  onTest: (toolId: ToolCatalogId) => void
  onOpenSettings: (toolId: ToolCatalogId) => void
  onPinChange: (toolId: ToolCatalogId, pinned: boolean) => void
  onSendDiagnostic?: (toolId: ToolCatalogId) => void
}

export function ToolCatalogSettings({
  entries,
  preferences,
  loading = false,
  refreshing = false,
  refreshStatus = 'fresh',
  refreshErrorCode = null,
  testingToolIds = [],
  pinningToolIds = [],
  pinError = null,
  onRefresh,
  onTest,
  onOpenSettings,
  onPinChange,
  onSendDiagnostic,
}: ToolCatalogSettingsProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ToolCatalogFilter>('all')
  const [expandedToolId, setExpandedToolId] = useState<ToolCatalogId | null>(null)
  const groups = useMemo(() => selectToolCatalogSettingsGroups(entries, preferences, { search, filter }), [entries, filter, preferences, search])
  const testingIds = useMemo(() => new Set(testingToolIds), [testingToolIds])
  const pinningIds = useMemo(() => new Set(pinningToolIds), [pinningToolIds])
  const setExpanded = useCallback((toolId: ToolCatalogId, expanded: boolean) => setExpandedToolId(expanded ? toolId : null), [])
  const hasEntries = entries.length > 0
  const unavailable = !loading && refreshStatus === 'failed' && !hasEntries
  const empty = !loading && !unavailable && groups.length === 0

  return (
    <section aria-label="Tool catalog" className="min-w-0 space-y-3">
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search tools</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-app-text-muted" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools" className="h-9 w-full rounded-md border border-app-border bg-app-bg pl-8 pr-3 text-xs text-app-text outline-none placeholder:text-app-text-muted focus:border-app-accent" />
        </label>
        {onRefresh && (
          <button
            type="button"
            className={cn(iconButton(), 'h-9 w-9')}
            disabled={loading || refreshing}
            title="Refresh tool catalog"
            aria-label="Refresh tool catalog"
            onClick={onRefresh}
          >
            {refreshing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-app-bg p-1 sm:grid-cols-4" role="group" aria-label="Tool catalog filter">
        {TOOL_CATALOG_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'h-8 rounded px-2 text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent',
              filter === option.value
                ? 'bg-app-surface-2 text-app-text'
                : 'text-app-text-muted hover:bg-app-surface-2/60 hover:text-app-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ToolCatalogState loading={loading} refreshStatus={refreshStatus} hasEntries={hasEntries} errorCode={refreshErrorCode} />
      {unavailable && (
        <div className="border-y border-app-danger/30 px-3 py-5 text-center text-xs text-app-text-muted" role="alert">
          Tool catalog unavailable{refreshErrorCode ? ` (${refreshErrorCode.slice(0, 80)})` : ''}.
        </div>
      )}
      {empty && (
        <div className="border-y border-app-border px-3 py-5 text-center text-xs text-app-text-muted">
          {hasEntries ? 'No tools match this view.' : 'No tools available.'}
        </div>
      )}
      {groups.map((group) => (
        <ToolGroup key={group.source} label={group.label}>
          {group.entries.map((entry) => (
            <CatalogToolRow
              key={entry.id}
              entry={entry}
              expanded={expandedToolId === entry.id}
              testing={testingIds.has(entry.id)}
              pinning={pinningIds.has(entry.id)}
              onExpandedChange={setExpanded}
              onTest={onTest}
              onOpenSettings={onOpenSettings}
              onPinChange={onPinChange}
              onSendDiagnostic={onSendDiagnostic}
            />
          ))}
        </ToolGroup>
      ))}
      <div className="sr-only" aria-live="polite">{refreshing ? 'Refreshing tool catalog.' : pinError ?? ''}</div>
    </section>
  )
}
