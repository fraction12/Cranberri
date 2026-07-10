import { describe, expect, it } from 'vitest'
import type {
  ToolCatalogEntry,
  ToolCatalogId,
  ToolCatalogPreferences,
  ToolCatalogSource,
} from '@/shared/tools'
import { selectToolCatalogSettingsGroups } from './tool-catalog-settings-model'

const PREFERENCES: ToolCatalogPreferences = {
  pinnedToolIds: ['mcp:github-provider:search', 'mcp:missing:lookup'],
  dismissedDefaultToolIds: [],
}

function entry(
  id: string,
  name: string,
  source: ToolCatalogSource,
  overrides: Partial<ToolCatalogEntry> = {},
): ToolCatalogEntry {
  return {
    id: id as ToolCatalogId,
    name,
    source,
    description: null,
    isDefault: false,
    probeCapability: { kind: 'unsupported', reason: 'Not probeable.' },
    isPinned: false,
    isDismissedDefault: false,
    inRail: false,
    isOrphan: false,
    machine: {
      status: 'unknown',
      version: null,
      observedAt: null,
      stale: false,
      provenance: 'none',
      diagnosticCode: null,
    },
    task: {
      status: 'no-active-task',
      taskKey: null,
      observedAt: null,
      provenance: 'no-active-task',
    },
    activity: null,
    ...overrides,
  }
}

const ENTRIES = [
  entry('codex:apply_patch', 'apply_patch', { kind: 'codex' }, {
    machine: {
      status: 'available',
      version: null,
      observedAt: '2026-07-09T12:00:00.000Z',
      stale: false,
      provenance: 'global-registry',
      diagnosticCode: null,
    },
  }),
  entry('cli:gh', 'gh', { kind: 'cli' }, {
    description: 'raw-registry-secret',
    machine: {
      status: 'authentication-required',
      version: '2.0.0',
      observedAt: '2026-07-09T12:00:00.000Z',
      stale: false,
      provenance: 'local-probe',
      diagnosticCode: 'auth-required',
    },
  }),
  entry('mcp:github-provider:search', 'search', {
    kind: 'mcp',
    providerId: 'github-provider',
    providerName: 'GitHub',
  }),
  entry('mcp:missing:lookup', 'lookup', { kind: 'mcp', providerId: 'missing' }, {
    isPinned: true,
    inRail: true,
    isOrphan: true,
  }),
]

function ids(search = '', filter: 'all' | 'available' | 'needs-attention' | 'pinned' = 'all') {
  return selectToolCatalogSettingsGroups(ENTRIES, PREFERENCES, { search, filter })
    .flatMap((group) => group.entries.map((tool) => tool.id))
}

describe('tool catalog settings model', () => {
  it('searches literal names, source labels, and provider labels only', () => {
    expect(ids('apply')).toEqual(['codex:apply_patch'])
    expect(ids('CLI')).toEqual(['cli:gh'])
    expect(ids('GitHub')).toEqual(['mcp:github-provider:search'])
    expect(ids('github-provider')).toEqual(['mcp:github-provider:search'])
    expect(ids('raw-registry-secret')).toEqual([])
  })

  it('filters by availability and current rail pin state', () => {
    expect(ids('', 'available')).toEqual(['codex:apply_patch'])
    expect(ids('', 'needs-attention')).toEqual(['cli:gh', 'mcp:missing:lookup'])
    expect(ids('', 'pinned')).toEqual(['mcp:missing:lookup', 'mcp:github-provider:search'])
  })

  it('keeps an orphan pin visible in its source group', () => {
    const groups = selectToolCatalogSettingsGroups(ENTRIES, PREFERENCES, {
      search: 'lookup',
      filter: 'pinned',
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Connected MCP')
    expect(groups[0].entries[0]).toMatchObject({
      id: 'mcp:missing:lookup',
      isOrphan: true,
      inRail: true,
    })
  })
})
