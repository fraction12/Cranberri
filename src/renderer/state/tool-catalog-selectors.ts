import {
  toolCatalogMembership as sharedToolMembership,
  type ToolCatalogEntry,
  type ToolCatalogMachineStatus,
  type ToolCatalogPreferences,
  type ToolCatalogSource,
  type ToolCatalogTaskStatus,
} from '@/shared/tools'

export type ToolCatalogSourceKind = ToolCatalogSource['kind']
export type ToolAvailability = 'available' | 'needs-attention'

export interface ToolCatalogGroup {
  source: ToolCatalogSourceKind
  label: string
  entries: ToolCatalogEntry[]
}

export const TOOL_CATALOG_SOURCE_ORDER: readonly ToolCatalogSourceKind[] = [
  'codex',
  'cli',
  'browser',
  'mcp',
]

const SOURCE_LABELS: Record<ToolCatalogSourceKind, string> = {
  codex: 'Codex',
  cli: 'CLI',
  browser: 'Browser/Web',
  mcp: 'Connected MCP',
}

const MACHINE_STATUS_LABELS: Record<ToolCatalogMachineStatus, string> = {
  unknown: 'Unavailable',
  available: 'Ready',
  installed: 'Installed',
  missing: 'Not installed',
  connected: 'Connected',
  disconnected: 'Disconnected',
  'authentication-required': 'Authentication required',
}

const TASK_STATUS_LABELS: Record<ToolCatalogTaskStatus, string> = {
  'no-active-task': 'No active task',
  unknown: 'Unavailable',
  addressable: 'Ready',
  usable: 'Used successfully',
  unavailable: 'Unavailable',
  'authentication-required': 'Authentication required',
  'approval-required': 'Approval required',
  denied: 'Denied',
}

const AVAILABLE_MACHINE_STATUSES = new Set<ToolCatalogMachineStatus>(['available', 'installed', 'connected'])
const ATTENTION_MACHINE_STATUSES = new Set<ToolCatalogMachineStatus>(['missing', 'disconnected', 'authentication-required'])
const AVAILABLE_TASK_STATUSES = new Set<ToolCatalogTaskStatus>(['addressable', 'usable'])
const ATTENTION_TASK_STATUSES = new Set<ToolCatalogTaskStatus>([
  'unavailable',
  'authentication-required',
  'approval-required',
  'denied',
])
const literalNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function toolSourceLabel(source: ToolCatalogSource): string {
  return SOURCE_LABELS[source.kind]
}

export function toolProviderLabel(source: ToolCatalogSource): string | null {
  if (source.kind === 'codex' || source.kind === 'cli') return null
  return source.providerName?.trim() || source.providerId
}

export function toolSourceDisplayLabel(source: ToolCatalogSource): string {
  const provider = toolProviderLabel(source)
  return provider ? `${toolSourceLabel(source)} · ${provider}` : toolSourceLabel(source)
}

export function toolSourceSearchText(source: ToolCatalogSource): string {
  if (source.kind === 'codex' || source.kind === 'cli') return toolSourceLabel(source)
  return [toolSourceLabel(source), source.providerName, source.providerId].filter(Boolean).join(' ')
}

export function toolMachineContextLabel(source: ToolCatalogSource): 'Machine' | 'Connection' {
  return source.kind === 'browser' || source.kind === 'mcp' ? 'Connection' : 'Machine'
}

export function toolMachineStatusLabel(status: ToolCatalogMachineStatus): string {
  return MACHINE_STATUS_LABELS[status]
}

export function toolTaskStatusLabel(status: ToolCatalogTaskStatus): string {
  return TASK_STATUS_LABELS[status]
}

export function toolAvailability(entry: ToolCatalogEntry): ToolAvailability {
  if (
    entry.isOrphan
    || entry.machine.stale
    || ATTENTION_MACHINE_STATUSES.has(entry.machine.status)
    || ATTENTION_TASK_STATUSES.has(entry.task.status)
  ) return 'needs-attention'
  if (
    AVAILABLE_MACHINE_STATUSES.has(entry.machine.status)
    || AVAILABLE_TASK_STATUSES.has(entry.task.status)
  ) return 'available'
  return 'needs-attention'
}

export function toolAvailabilityLabel(entry: ToolCatalogEntry): string {
  if (entry.isOrphan) return 'Provider unavailable'
  if (entry.machine.stale) return 'Refresh needed'
  if (ATTENTION_MACHINE_STATUSES.has(entry.machine.status)) {
    return toolMachineStatusLabel(entry.machine.status)
  }
  if (ATTENTION_TASK_STATUSES.has(entry.task.status)) return toolTaskStatusLabel(entry.task.status)
  return toolAvailability(entry) === 'available' ? 'Ready' : 'Unavailable'
}

export const toolMembership = sharedToolMembership

export function selectToolEntriesWithPreferences(
  entries: readonly ToolCatalogEntry[],
  preferences: ToolCatalogPreferences,
): ToolCatalogEntry[] {
  return entries.flatMap((entry) => {
    const membership = toolMembership(entry, preferences)
    if (entry.isOrphan && !membership.isPinned) return []
    return [{ ...entry, ...membership }]
  })
}

export function selectToolCatalogGroups(entries: readonly ToolCatalogEntry[]): ToolCatalogGroup[] {
  return TOOL_CATALOG_SOURCE_ORDER.flatMap((source) => {
    const sourceEntries = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.source.kind === source)
      .sort((left, right) => (
        literalNameCollator.compare(left.entry.name, right.entry.name) || left.index - right.index
      ))
      .map(({ entry }) => entry)
    return sourceEntries.length ? [{ source, label: SOURCE_LABELS[source], entries: sourceEntries }] : []
  })
}

export function selectRailToolGroups(entries: readonly ToolCatalogEntry[]): ToolCatalogGroup[] {
  return selectToolCatalogGroups(entries.filter((entry) => entry.inRail))
}

export function setToolPinned(
  preferences: ToolCatalogPreferences,
  entry: ToolCatalogEntry,
  shouldPin: boolean,
): ToolCatalogPreferences {
  const withoutPin = preferences.pinnedToolIds.filter((id) => id !== entry.id)
  const withoutDismissal = preferences.dismissedDefaultToolIds.filter((id) => id !== entry.id)
  if (shouldPin) {
    return {
      pinnedToolIds: entry.isDefault ? withoutPin : [...withoutPin, entry.id],
      dismissedDefaultToolIds: withoutDismissal,
    }
  }
  return {
    pinnedToolIds: withoutPin,
    dismissedDefaultToolIds: entry.isDefault ? [...withoutDismissal, entry.id] : withoutDismissal,
  }
}
