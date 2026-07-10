import type { ToolCatalogEntry, ToolCatalogPreferences } from '@/shared/tools'
import {
  selectToolCatalogGroups,
  selectToolEntriesWithPreferences,
  toolAvailability,
  toolSourceSearchText,
  type ToolCatalogGroup,
} from '../../state/tool-catalog-selectors'

export const TOOL_CATALOG_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Ready' },
  { value: 'needs-attention', label: 'Action' },
  { value: 'pinned', label: 'In rail' },
] as const

export type ToolCatalogFilter = (typeof TOOL_CATALOG_FILTER_OPTIONS)[number]['value']

export interface ToolCatalogSettingsQuery {
  search: string
  filter: ToolCatalogFilter
}

export function toolMatchesCatalogSearch(entry: ToolCatalogEntry, search: string): boolean {
  const query = search.trim().toLocaleLowerCase('en')
  if (!query) return true
  return [entry.name, toolSourceSearchText(entry.source)]
    .join(' ')
    .toLocaleLowerCase('en')
    .includes(query)
}

export function toolMatchesCatalogFilter(entry: ToolCatalogEntry, filter: ToolCatalogFilter): boolean {
  if (filter === 'available') return toolAvailability(entry) === 'available'
  if (filter === 'needs-attention') return toolAvailability(entry) === 'needs-attention'
  if (filter === 'pinned') return entry.inRail
  return true
}

export function selectToolCatalogSettingsGroups(
  entries: readonly ToolCatalogEntry[],
  preferences: ToolCatalogPreferences,
  query: ToolCatalogSettingsQuery,
): ToolCatalogGroup[] {
  const visibleEntries = selectToolEntriesWithPreferences(entries, preferences)
    .filter((entry) => toolMatchesCatalogSearch(entry, query.search))
    .filter((entry) => toolMatchesCatalogFilter(entry, query.filter))
  return selectToolCatalogGroups(visibleEntries)
}
