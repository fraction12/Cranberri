import { useCallback, useMemo, useState } from 'react'
import type {
  ToolCatalogEntry,
  ToolCatalogId,
  ToolCatalogPreferences,
  ToolCatalogSnapshot,
} from '@/shared/tools'
import { ToolGroup } from '../right-rail/tool-group'
import { CatalogToolRow } from './catalog-tool-row'
import { ToolCatalogControls } from './tool-catalog-controls'
import { ToolCatalogState } from './tool-catalog-state'
import { typeStyle } from '../../lib/typography'
import {
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
      <ToolCatalogControls
        search={search}
        filter={filter}
        loading={loading}
        refreshing={refreshing}
        onSearchChange={setSearch}
        onFilterChange={setFilter}
        onRefresh={onRefresh}
      />
      <ToolCatalogState loading={loading} refreshStatus={refreshStatus} hasEntries={hasEntries} errorCode={refreshErrorCode} />
      {unavailable && (
        <div className={`rounded-md bg-app-danger/5 px-3 py-5 text-center ${typeStyle({ role: 'status', tone: 'danger' })}`} role="alert" title={refreshErrorCode ?? undefined}>
          Tools could not be loaded. Try refreshing.
        </div>
      )}
      {empty && (
        <div className={`rounded-md bg-app-bg px-3 py-5 text-center ${typeStyle({ role: 'metadata', tone: 'secondary' })}`}>
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
      <div className="sr-only" aria-live="polite">{refreshing ? 'Refreshing tool catalog.' : ''}</div>
    </section>
  )
}
