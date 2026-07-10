import {
  toolCatalogSnapshotSchema,
  type ToolCatalogActivitySummary,
  type ToolCatalogCapabilityEvidence,
  type ToolCatalogDescriptor,
  type ToolCatalogDirectEvent,
  type ToolCatalogEntry,
  type ToolCatalogId,
  type ToolCatalogMachineState,
  type ToolCatalogPreferences,
  type ToolCatalogProbeResult,
  type ToolCatalogRefreshFailure,
  type ToolCatalogRegistryEvidence,
  type ToolCatalogSnapshot,
  type ToolCatalogSource,
  type ToolCatalogTaskKey,
  type ToolCatalogTaskProvenance,
  type ToolCatalogTaskState,
} from '../shared/tools'

const EMPTY_PREFERENCES: ToolCatalogPreferences = {
  pinnedToolIds: [],
  dismissedDefaultToolIds: [],
}

function encodeIdComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function decodeIdComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function createToolCatalogId(source: ToolCatalogSource, name: string): ToolCatalogId {
  const encodedName = encodeIdComponent(name)
  if (source.kind === 'codex' || source.kind === 'cli') return `${source.kind}:${encodedName}`
  return `${source.kind}:${encodeIdComponent(source.providerId)}:${encodedName}`
}

export function parseToolCatalogId(id: string): { source: ToolCatalogSource; name: string } | null {
  const parts = id.split(':')
  if (parts.length === 2 && (parts[0] === 'codex' || parts[0] === 'cli')) {
    const name = decodeIdComponent(parts[1])
    return name ? { source: { kind: parts[0] }, name } : null
  }
  if (parts.length === 3 && (parts[0] === 'browser' || parts[0] === 'mcp')) {
    const providerId = decodeIdComponent(parts[1])
    const name = decodeIdComponent(parts[2])
    return providerId && name ? { source: { kind: parts[0], providerId }, name } : null
  }
  return null
}

function descriptor(
  source: ToolCatalogSource,
  name: string,
  description: string,
  isDefault = true,
  probeCapability: ToolCatalogDescriptor['probeCapability'] = {
    kind: 'unsupported',
    reason: 'Readiness comes from Codex runtime metadata.',
  },
): ToolCatalogDescriptor {
  return {
    id: createToolCatalogId(source, name),
    name,
    source,
    description,
    isDefault,
    probeCapability,
  }
}

const CODEX_DEFAULTS: ToolCatalogDescriptor[] = [
  descriptor({ kind: 'codex' }, 'exec_command', 'Runs a shell command through the Codex runtime.'),
  descriptor({ kind: 'codex' }, 'apply_patch', 'Applies a structured patch to workspace files.'),
]

const CLI_DESCRIPTIONS: Record<string, string> = {
  rg: 'Fast recursive text search.',
  grep: 'Pattern search for text streams and files.',
  find: 'Filesystem path discovery.',
  git: 'Version control command-line client.',
  gh: 'GitHub command-line client.',
  node: 'Node.js JavaScript runtime.',
  npm: 'Node.js package manager.',
  npx: 'Runs commands from npm packages.',
  python3: 'Python 3 runtime.',
  pip: 'Python package installer.',
  jq: 'JSON query and transformation tool.',
  curl: 'HTTP and data-transfer client.',
}

const CLI_DEFAULTS = Object.entries(CLI_DESCRIPTIONS).map(([name, description]) =>
  descriptor(
    { kind: 'cli' },
    name,
    description,
    true,
    name === 'gh'
      ? { kind: 'manual-only', reason: 'Authentication checks run only when requested.' }
      : { kind: 'automatic' },
  ),
)

const BROWSER_DEFAULTS: ToolCatalogDescriptor[] = [
  descriptor(
    { kind: 'browser', providerId: 'codex-runtime', providerName: 'Codex runtime' },
    'web_search',
    'Searches the web through the Codex runtime.',
  ),
  descriptor(
    { kind: 'browser', providerId: 'cranberri-browser', providerName: 'Cranberri browser' },
    'browser',
    'Controls Cranberri browser tabs and page inspection.',
  ),
]

export const DEFAULT_TOOL_CATALOG_DESCRIPTORS: ToolCatalogDescriptor[] = [
  ...CODEX_DEFAULTS,
  ...CLI_DEFAULTS,
  ...BROWSER_DEFAULTS,
]

export interface AssembleToolCatalogInput {
  now: string
  descriptors?: ToolCatalogDescriptor[]
  activeTask?: ToolCatalogTaskKey | null
  preferences?: ToolCatalogPreferences
  probeResults?: ToolCatalogProbeResult[]
  registryEvidence?: ToolCatalogRegistryEvidence[]
  capabilityEvidence?: ToolCatalogCapabilityEvidence[]
  directEvents?: ToolCatalogDirectEvent[]
  lastGood?: ToolCatalogSnapshot | null
  refreshFailure?: ToolCatalogRefreshFailure | null
}

function sameTask(left: ToolCatalogTaskKey | null | undefined, right: ToolCatalogTaskKey | null | undefined): boolean {
  return Boolean(
    left
    && right
    && left.threadId === right.threadId
    && left.capabilityEpoch === right.capabilityEpoch,
  )
}

function isNewer(candidate: string | null | undefined, current: string | null | undefined): boolean {
  if (!candidate) return false
  if (!current) return true
  return candidate >= current
}

function emptyMachineState(): ToolCatalogMachineState {
  return {
    status: 'unknown',
    version: null,
    observedAt: null,
    stale: false,
    provenance: 'none',
    diagnosticCode: null,
  }
}

function noTaskState(activeTask: ToolCatalogTaskKey | null): ToolCatalogTaskState {
  return activeTask
    ? {
        status: 'unknown',
        taskKey: activeTask,
        observedAt: null,
        provenance: 'none',
      }
    : {
        status: 'no-active-task',
        taskKey: null,
        observedAt: null,
        provenance: 'no-active-task',
      }
}

function registryMachineStatus(authStatus: string): ToolCatalogMachineState['status'] {
  const normalized = authStatus.toLowerCase().replace(/[^a-z]/g, '')
  if (normalized.includes('notauthenticated') || normalized.includes('authenticationrequired')) {
    return 'authentication-required'
  }
  if (normalized.includes('disabled') || normalized.includes('disconnected') || normalized.includes('unavailable')) {
    return 'disconnected'
  }
  return 'connected'
}

function registryDescriptors(evidence: ToolCatalogRegistryEvidence[]): ToolCatalogDescriptor[] {
  const descriptors = new Map<string, ToolCatalogDescriptor>()
  for (const item of evidence) {
    for (const server of item.snapshot.mcpServers) {
      const source: ToolCatalogSource = {
        kind: 'mcp',
        providerId: server.name,
        providerName: server.name,
      }
      for (const tool of server.tools) {
        const entry = descriptor(
          source,
          tool.name,
          tool.description ?? tool.title ?? `${tool.name} from ${server.name}.`,
          false,
          { kind: 'unsupported', reason: 'MCP tools are never invoked as health checks.' },
        )
        descriptors.set(entry.id, entry)
      }
    }
  }
  return [...descriptors.values()]
}

function taskStateFromOutcome(
  activeTask: ToolCatalogTaskKey,
  event: ToolCatalogDirectEvent,
): ToolCatalogTaskState {
  const states: Record<ToolCatalogDirectEvent['outcome'], {
    status: ToolCatalogTaskState['status']
    provenance: ToolCatalogTaskProvenance
  }> = {
    started: { status: 'addressable', provenance: 'same-task-started' },
    succeeded: { status: 'usable', provenance: 'same-task-success' },
    failed: { status: 'unavailable', provenance: 'same-task-failure' },
    denied: { status: 'denied', provenance: 'same-task-denied' },
    'authentication-required': { status: 'authentication-required', provenance: 'same-task-authentication' },
    'approval-required': { status: 'approval-required', provenance: 'same-task-approval' },
  }
  return {
    ...states[event.outcome],
    taskKey: activeTask,
    observedAt: event.observedAt,
  }
}

function taskProvenanceFromCapability(
  status: ToolCatalogCapabilityEvidence['status'],
): ToolCatalogTaskProvenance {
  switch (status) {
    case 'authentication-required': return 'same-task-authentication'
    case 'approval-required': return 'same-task-approval'
    case 'denied': return 'same-task-denied'
    case 'unavailable': return 'same-task-failure'
    default: return 'authoritative-capability'
  }
}

function activityFromEvent(event: ToolCatalogDirectEvent | undefined): ToolCatalogActivitySummary | null {
  if (!event) return null
  return {
    outcome: event.outcome,
    observedAt: event.observedAt,
    callId: event.callId,
    durationMs: event.durationMs,
  }
}

function orphanDescriptor(id: string): ToolCatalogDescriptor | null {
  const parsed = parseToolCatalogId(id)
  if (!parsed) return null
  return {
    id,
    name: parsed.name,
    source: parsed.source,
    description: 'Pinned tool metadata is unavailable until its provider reconnects.',
    isDefault: false,
    probeCapability: { kind: 'unsupported', reason: 'Provider metadata is unavailable.' },
  }
}

export function assembleToolCatalog(input: AssembleToolCatalogInput): ToolCatalogSnapshot {
  const activeTask = input.activeTask ?? null
  const preferences = input.preferences ?? EMPTY_PREFERENCES
  const evidence = input.registryEvidence ?? []
  const baseDescriptors = input.descriptors ?? DEFAULT_TOOL_CATALOG_DESCRIPTORS
  const descriptorMap = new Map<string, ToolCatalogDescriptor>()
  for (const entry of [...baseDescriptors, ...registryDescriptors(evidence)]) descriptorMap.set(entry.id, entry)
  const currentDescriptorIds = new Set(descriptorMap.keys())

  if (input.lastGood) {
    for (const entry of input.lastGood.entries) {
      if (!descriptorMap.has(entry.id) && !entry.isOrphan) {
        descriptorMap.set(entry.id, {
          id: entry.id,
          name: entry.name,
          source: entry.source,
          description: entry.description,
          isDefault: entry.isDefault,
          probeCapability: entry.probeCapability,
        })
      }
    }
  }

  for (const pinnedId of preferences.pinnedToolIds) {
    if (!descriptorMap.has(pinnedId)) {
      const orphan = orphanDescriptor(pinnedId)
      if (orphan) descriptorMap.set(pinnedId, orphan)
    }
  }

  const latestProbe = new Map<string, ToolCatalogProbeResult>()
  for (const result of input.probeResults ?? []) {
    const current = latestProbe.get(result.catalogId)
    if (!current || isNewer(result.observedAt, current.observedAt)) latestProbe.set(result.catalogId, result)
  }

  const currentDirectEvents = new Map<string, ToolCatalogDirectEvent>()
  for (const event of input.directEvents ?? []) {
    if (!sameTask(event.taskKey, activeTask)) continue
    const current = currentDirectEvents.get(event.catalogId)
    if (!current || isNewer(event.observedAt, current.observedAt)) currentDirectEvents.set(event.catalogId, event)
  }

  const currentCapabilities = new Map<string, ToolCatalogCapabilityEvidence>()
  for (const capability of input.capabilityEvidence ?? []) {
    if (!sameTask(capability.taskKey, activeTask)) continue
    const current = currentCapabilities.get(capability.catalogId)
    if (!current || isNewer(capability.observedAt, current.observedAt)) {
      currentCapabilities.set(capability.catalogId, capability)
    }
  }

  const registryById = new Map<string, { evidence: ToolCatalogRegistryEvidence; status: ToolCatalogMachineState['status'] }>()
  for (const item of evidence) {
    for (const server of item.snapshot.mcpServers) {
      const source: ToolCatalogSource = {
        kind: 'mcp',
        providerId: server.name,
        providerName: server.name,
      }
      for (const tool of server.tools) {
        const id = createToolCatalogId(source, tool.name)
        const current = registryById.get(id)
        if (!current || isNewer(item.observedAt, current.evidence.observedAt)) {
          registryById.set(id, { evidence: item, status: registryMachineStatus(server.authStatus) })
        }
      }
    }
  }

  const lastGoodById = new Map(input.lastGood?.entries.map((entry) => [entry.id, entry]) ?? [])
  const pinnedIds = new Set(preferences.pinnedToolIds)
  const dismissedIds = new Set(preferences.dismissedDefaultToolIds)

  const entries: ToolCatalogEntry[] = [...descriptorMap.values()].map((entry) => {
    const probe = latestProbe.get(entry.id)
    const registry = registryById.get(entry.id)
    const lastGood = lastGoodById.get(entry.id)
    let machine = emptyMachineState()

    if (registry) {
      machine = {
        status: registry.status,
        version: null,
        observedAt: registry.evidence.observedAt,
        stale: false,
        provenance: registry.evidence.scope === 'active-task'
          ? 'active-task-inventory'
          : registry.evidence.scope === 'stale-thread-fallback'
            ? 'stale-thread-fallback'
            : 'global-registry',
        diagnosticCode: null,
      }
    }
    if (probe && isNewer(probe.observedAt, machine.observedAt)) {
      machine = {
        status: probe.status,
        version: probe.version,
        observedAt: probe.observedAt,
        stale: false,
        provenance: 'local-probe',
        diagnosticCode: probe.diagnosticCode,
      }
    }
    if (input.refreshFailure && machine.observedAt === null && lastGood) {
      machine = {
        ...lastGood.machine,
        stale: true,
        provenance: 'last-good',
        diagnosticCode: input.refreshFailure.code,
      }
    }

    let task = noTaskState(activeTask)
    if (activeTask) {
      const activeInventory = evidence
        .filter((item) => item.scope === 'active-task' && sameTask(item.taskKey, activeTask))
        .find((item) => item.snapshot.mcpServers.some((server) => {
          const source: ToolCatalogSource = { kind: 'mcp', providerId: server.name, providerName: server.name }
          return server.tools.some((tool) => createToolCatalogId(source, tool.name) === entry.id)
        }))
      const weakInventory = registry?.evidence
      if (activeInventory) {
        task = {
          status: 'addressable',
          taskKey: activeTask,
          observedAt: activeInventory.observedAt,
          provenance: 'active-task-inventory',
        }
      } else if (weakInventory) {
        task = {
          status: 'unknown',
          taskKey: activeTask,
          observedAt: weakInventory.observedAt,
          provenance: weakInventory.scope === 'stale-thread-fallback'
            ? 'stale-thread-fallback'
            : 'global-registry',
        }
      }

      const capability = currentCapabilities.get(entry.id)
      if (capability && isNewer(capability.observedAt, task.observedAt)) {
        task = {
          status: capability.status,
          taskKey: activeTask,
          observedAt: capability.observedAt,
          provenance: taskProvenanceFromCapability(capability.status),
        }
      }
      const directEvent = currentDirectEvents.get(entry.id)
      if (directEvent && isNewer(directEvent.observedAt, task.observedAt)) {
        task = taskStateFromOutcome(activeTask, directEvent)
      }
      if (
        task.status === 'unknown'
        && ['missing', 'disconnected', 'authentication-required'].includes(machine.status)
      ) {
        task = {
          status: machine.status === 'authentication-required' ? 'authentication-required' : 'unavailable',
          taskKey: activeTask,
          observedAt: machine.observedAt,
          provenance: 'machine-unavailable',
        }
      }
    }

    const isPinned = pinnedIds.has(entry.id)
    const isDismissedDefault = entry.isDefault && dismissedIds.has(entry.id)
    const isOrphan = pinnedIds.has(entry.id) && !currentDescriptorIds.has(entry.id) && !lastGoodById.has(entry.id)

    return {
      ...entry,
      isPinned,
      isDismissedDefault,
      inRail: isPinned || (entry.isDefault && !isDismissedDefault),
      isOrphan,
      machine,
      task,
      activity: activityFromEvent(currentDirectEvents.get(entry.id)),
    }
  })

  const refresh = input.refreshFailure
    ? {
        status: input.lastGood ? 'stale' as const : 'failed' as const,
        observedAt: input.refreshFailure.observedAt,
        errorCode: input.refreshFailure.code,
      }
    : {
        status: 'fresh' as const,
        observedAt: input.now,
        errorCode: null,
      }

  return toolCatalogSnapshotSchema.parse({
    generatedAt: input.now,
    taskKey: activeTask,
    entries,
    railToolIds: entries.filter((entry) => entry.inRail).map((entry) => entry.id),
    preservedPinnedToolIds: [...preferences.pinnedToolIds],
    orphanPinnedToolIds: entries.filter((entry) => entry.isOrphan).map((entry) => entry.id),
    refresh,
  })
}
