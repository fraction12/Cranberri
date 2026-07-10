import { Loader2, RefreshCw, Search } from 'lucide-react'
import { cn, iconButton } from '../../lib/ui'
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
            className="h-9 w-full rounded-md border border-app-border bg-app-bg pl-8 pr-3 text-xs text-app-text outline-none placeholder:text-app-text-muted focus:border-app-accent"
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
      <div className="grid grid-cols-2 gap-1 rounded-md bg-app-bg p-1 sm:grid-cols-4" role="group" aria-label="Tool catalog filter">
        {TOOL_CATALOG_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange(option.value)}
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
    </>
  )
}
