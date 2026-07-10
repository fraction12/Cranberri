import { describe, expect, it } from 'vitest'
import {
  toolCatalogActivitySummarySchema,
  toolCatalogSnapshotSchema,
  type ToolCatalogDescriptor,
  type ToolCatalogRegistryEvidence,
  type ToolCatalogSource,
  type ToolCatalogTaskKey,
} from '../shared/tools'
import {
  DEFAULT_TOOL_CATALOG_DESCRIPTORS,
  assembleToolCatalog,
  createToolCatalogId,
  parseToolCatalogId,
} from './tool-catalog'

const NOW = '2026-07-09T20:00:00.000Z'
const LATER = '2026-07-09T20:05:00.000Z'
const TASK: ToolCatalogTaskKey = { threadId: 'thread-1', capabilityEpoch: 'epoch-1' }

function descriptor(source: ToolCatalogSource, name: string, isDefault = false): ToolCatalogDescriptor {
  return {
    id: createToolCatalogId(source, name),
    name,
    source,
    description: `${name} test descriptor`,
    isDefault,
    probeCapability: source.kind === 'cli'
      ? { kind: 'automatic' }
      : { kind: 'unsupported', reason: 'Runtime metadata only' },
  }
}

function registryEvidence(
  scope: ToolCatalogRegistryEvidence['scope'],
  taskKey: ToolCatalogTaskKey | null = null,
): ToolCatalogRegistryEvidence {
  const common = {
    observedAt: NOW,
    snapshot: {
      generatedAt: NOW,
      apps: [],
      mcpServers: [{
        name: 'provider:alpha',
        authStatus: 'oAuth',
        toolCount: 1,
        resourceCount: 0,
        resourceTemplateCount: 0,
        tools: [{ name: 'search/items', title: 'Search items', description: 'Search provider items' }],
      }],
      capabilities: { appList: true, mcpServerStatus: true, errors: [] },
    },
  }

  if (scope === 'active-task') return { ...common, scope, taskKey: taskKey ?? TASK }
  return { ...common, scope, taskKey: null }
}

function catalogEntry(snapshot: ReturnType<typeof assembleToolCatalog>, id: string) {
  const entry = snapshot.entries.find((candidate) => candidate.id === id)
  expect(entry, `missing catalog entry ${id}`).toBeDefined()
  return entry!
}

describe('tool catalog IDs and defaults', () => {
  it('encodes delimiter-bearing components and avoids cross-source/provider collisions', () => {
    const name = 'search:repo/%'
    const ids = [
      createToolCatalogId({ kind: 'codex' }, name),
      createToolCatalogId({ kind: 'cli' }, name),
      createToolCatalogId({ kind: 'browser', providerId: 'provider:one', providerName: 'One' }, name),
      createToolCatalogId({ kind: 'mcp', providerId: 'provider:one', providerName: 'One' }, name),
      createToolCatalogId({ kind: 'mcp', providerId: 'provider:two', providerName: 'Two' }, name),
    ]

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[1]).toBe('cli:search%3Arepo%2F%25')
    expect(ids[2]).toBe('browser:provider%3Aone:search%3Arepo%2F%25')
    expect(parseToolCatalogId(ids[2])).toEqual({
      source: { kind: 'browser', providerId: 'provider:one' },
      name,
    })
  })

  it('ships the planned Codex, CLI, and Browser/Web defaults', () => {
    const cliNames = DEFAULT_TOOL_CATALOG_DESCRIPTORS
      .filter((entry) => entry.source.kind === 'cli')
      .map((entry) => entry.name)
      .sort()

    expect(cliNames).toEqual([
      'curl', 'find', 'gh', 'git', 'grep', 'jq', 'node', 'npm', 'npx', 'pip', 'python3', 'rg',
    ])
    expect(DEFAULT_TOOL_CATALOG_DESCRIPTORS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:exec_command', isDefault: true }),
      expect.objectContaining({ id: 'codex:apply_patch', isDefault: true }),
      expect.objectContaining({ source: expect.objectContaining({ kind: 'browser' }), isDefault: true }),
    ]))
  })
})

describe('tool catalog evidence assembly', () => {
  it('keeps global and stale-fallback inventory unknown, active inventory addressable, and strong same-task evidence usable', () => {
    const id = createToolCatalogId(
      { kind: 'mcp', providerId: 'provider:alpha', providerName: 'provider:alpha' },
      'search/items',
    )

    const global = assembleToolCatalog({
      now: NOW,
      activeTask: TASK,
      registryEvidence: [registryEvidence('global')],
    })
    expect(catalogEntry(global, id)).toMatchObject({
      machine: { status: 'connected' },
      task: { status: 'unknown', provenance: 'global-registry' },
    })

    const fallback = assembleToolCatalog({
      now: NOW,
      activeTask: TASK,
      registryEvidence: [registryEvidence('stale-thread-fallback')],
    })
    expect(catalogEntry(fallback, id).task).toMatchObject({
      status: 'unknown',
      provenance: 'stale-thread-fallback',
    })

    const active = assembleToolCatalog({
      now: NOW,
      activeTask: TASK,
      registryEvidence: [registryEvidence('active-task', TASK)],
      directEvents: [{
        catalogId: id,
        taskKey: { ...TASK, capabilityEpoch: 'old-epoch' },
        outcome: 'succeeded',
        observedAt: LATER,
        callId: 'wrong-epoch-call',
        durationMs: 10,
      }],
    })
    expect(catalogEntry(active, id).task).toMatchObject({
      status: 'addressable',
      provenance: 'active-task-inventory',
    })

    const successful = assembleToolCatalog({
      now: LATER,
      activeTask: TASK,
      registryEvidence: [registryEvidence('active-task', TASK)],
      directEvents: [{
        catalogId: id,
        taskKey: TASK,
        outcome: 'succeeded',
        observedAt: LATER,
        callId: 'same-task-call',
        durationMs: 24,
      }],
    })
    expect(catalogEntry(successful, id)).toMatchObject({
      task: { status: 'usable', provenance: 'same-task-success' },
      activity: {
        outcome: 'succeeded',
        observedAt: LATER,
        callId: 'same-task-call',
        durationMs: 24,
      },
    })

    const rg = descriptor({ kind: 'cli' }, 'rg', true)
    const authoritative = assembleToolCatalog({
      now: NOW,
      descriptors: [rg],
      activeTask: TASK,
      capabilityEvidence: [{
        catalogId: rg.id,
        taskKey: TASK,
        status: 'usable',
        observedAt: NOW,
      }],
    })
    expect(catalogEntry(authoritative, rg.id).task).toMatchObject({
      status: 'usable',
      provenance: 'authoritative-capability',
    })
  })

  it('reports no-active-task without hiding machine health', () => {
    const rg = descriptor({ kind: 'cli' }, 'rg', true)
    const snapshot = assembleToolCatalog({
      now: NOW,
      descriptors: [rg],
      activeTask: null,
      probeResults: [{
        catalogId: rg.id,
        status: 'installed',
        version: '14.1.0',
        observedAt: NOW,
        diagnosticCode: null,
      }],
    })

    expect(catalogEntry(snapshot, rg.id)).toMatchObject({
      machine: {
        status: 'installed',
        version: '14.1.0',
        stale: false,
        provenance: 'local-probe',
      },
      task: { status: 'no-active-task', provenance: 'no-active-task' },
    })
  })

  it.each([
    ['failed', 'unavailable', 'same-task-failure'],
    ['denied', 'denied', 'same-task-denied'],
    ['authentication-required', 'authentication-required', 'same-task-authentication'],
    ['approval-required', 'approval-required', 'same-task-approval'],
  ] as const)('does not promote a %s direct call', (outcome, status, provenance) => {
    const applyPatch = descriptor({ kind: 'codex' }, 'apply_patch', true)
    const snapshot = assembleToolCatalog({
      now: NOW,
      descriptors: [applyPatch],
      activeTask: TASK,
      directEvents: [{
        catalogId: applyPatch.id,
        taskKey: TASK,
        outcome,
        observedAt: NOW,
        callId: 'call-1',
        durationMs: 12,
      }],
    })
    const entry = catalogEntry(snapshot, applyPatch.id)

    expect(entry.task).toMatchObject({ status, provenance })
    expect(entry.task.status).not.toBe('usable')
    expect(entry.activity).toEqual({
      outcome,
      observedAt: NOW,
      callId: 'call-1',
      durationMs: 12,
    })
  })

  it('keeps activity contracts metadata-only', () => {
    expect(toolCatalogActivitySummarySchema.safeParse({
      outcome: 'succeeded',
      observedAt: NOW,
      callId: 'call-1',
      durationMs: 12,
      argumentsPreview: 'secret input',
    }).success).toBe(false)
  })
})

describe('tool catalog curation and stale state', () => {
  it('computes defaults union pins minus dismissed defaults and materializes orphan pins', () => {
    const rg = descriptor({ kind: 'cli' }, 'rg', true)
    const git = descriptor({ kind: 'cli' }, 'git', true)
    const jq = descriptor({ kind: 'cli' }, 'jq')
    const orphanId = createToolCatalogId(
      { kind: 'mcp', providerId: 'gone:provider', providerName: 'Gone provider' },
      'search/repo',
    )
    const snapshot = assembleToolCatalog({
      now: NOW,
      descriptors: [rg, git, jq],
      preferences: {
        pinnedToolIds: [jq.id, orphanId],
        dismissedDefaultToolIds: [git.id],
      },
    })

    expect(snapshot.railToolIds).toEqual([rg.id, jq.id, orphanId])
    expect(snapshot.preservedPinnedToolIds).toEqual([jq.id, orphanId])
    expect(snapshot.orphanPinnedToolIds).toEqual([orphanId])
    expect(catalogEntry(snapshot, git.id)).toMatchObject({
      isDefault: true,
      isDismissedDefault: true,
      inRail: false,
    })
    expect(catalogEntry(snapshot, orphanId)).toMatchObject({
      name: 'search/repo',
      source: { kind: 'mcp', providerId: 'gone:provider' },
      isPinned: true,
      isOrphan: true,
      inRail: true,
      machine: { status: 'unknown' },
    })
  })

  it('preserves last-good machine state and missing entries as stale without retaining task usability', () => {
    const rg = descriptor({ kind: 'cli' }, 'rg', true)
    const jq = descriptor({ kind: 'cli' }, 'jq')
    const lastGood = assembleToolCatalog({
      now: NOW,
      descriptors: [rg, jq],
      activeTask: TASK,
      probeResults: [rg, jq].map((entry) => ({
        catalogId: entry.id,
        status: 'installed' as const,
        version: entry.name === 'rg' ? '14.1.0' : '1.7.1',
        observedAt: NOW,
        diagnosticCode: null,
      })),
      capabilityEvidence: [{
        catalogId: rg.id,
        taskKey: TASK,
        status: 'usable',
        observedAt: NOW,
      }],
    })
    const stale = assembleToolCatalog({
      now: LATER,
      descriptors: [rg],
      activeTask: TASK,
      lastGood,
      probeResults: [{
        catalogId: jq.id,
        status: 'installed',
        version: '1.7.1',
        observedAt: LATER,
        diagnosticCode: null,
      }],
      refreshFailures: [{
        catalogId: rg.id,
        code: 'probe-timeout',
        observedAt: LATER,
      }],
    })

    expect(toolCatalogSnapshotSchema.parse(stale)).toEqual(stale)
    expect(stale.refresh).toEqual({
      status: 'stale',
      observedAt: LATER,
      errorCode: 'probe-timeout',
    })
    expect(catalogEntry(stale, rg.id)).toMatchObject({
      machine: {
        status: 'installed',
        version: '14.1.0',
        stale: true,
        provenance: 'last-good',
        diagnosticCode: 'probe-timeout',
      },
      task: { status: 'unknown' },
      activity: null,
    })
    expect(catalogEntry(stale, jq.id)).toMatchObject({
      isOrphan: false,
      machine: {
        status: 'installed',
        version: '1.7.1',
        stale: false,
        provenance: 'local-probe',
      },
    })
  })

  it('reports registry failures without hiding independent probe health', () => {
    const rg = descriptor({ kind: 'cli' }, 'rg')
    const result = assembleToolCatalog({
      now: NOW,
      descriptors: [rg],
      activeTask: TASK,
      probeResults: [{
        catalogId: rg.id,
        status: 'installed',
        version: '14.1.0',
        observedAt: NOW,
        diagnosticCode: null,
      }],
      registryFailure: { code: 'registry-unavailable', observedAt: NOW },
    })

    expect(result.refresh).toEqual({
      status: 'stale',
      observedAt: NOW,
      errorCode: 'registry-unavailable',
    })
    expect(catalogEntry(result, rg.id).machine).toMatchObject({
      status: 'installed',
      stale: false,
      provenance: 'local-probe',
    })
  })
})
