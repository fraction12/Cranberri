import { Loader2, RefreshCw, Search } from 'lucide-react'
import { cn, fieldStyle, iconButton, segmentedControl, segmentedItem, segmentedItemActive } from '../../lib/ui'
import { TOOL_CATALOG_FILTER_OPTIONS, type ToolCatalogFilter } from './tool-catalog-settings-model'

interface ToolCatalogControlsProps {
  search: string
  filter: ToolCatalogFilter
  loading: boolean
  refreshing: boolean
  onSearchChange: (value: string) => void
  onFilterChange: (value: ToolCatalogFilter) => void
  onRefresh?: () => void
}

export function ToolCatalogControls({
  search,
  filter,
  loading,
  refreshing,
  onSearchChange,
  onFilterChange,
  onRefresh,
}: ToolCatalogControlsProps) {
  return (
    <>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search tools</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-app-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search tools"
            className={cn(fieldStyle, 'w-full pl-8 pr-3')}
          />
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
      <div className={cn(segmentedControl, 'grid-cols-4')} role="group" aria-label="Tool catalog filter">
        {TOOL_CATALOG_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            className={cn(
              segmentedItem,
              'h-8 px-2',
              filter === option.value
                ? segmentedItemActive
                : '',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  )
}
