import { describe, expect, it } from 'vitest'
import type {
  ToolCatalogEntry,
  ToolCatalogId,
  ToolCatalogSource,
} from '@/shared/tools'
import {
  selectRailToolGroups,
  selectToolCatalogGroups,
  selectToolEntriesWithPreferences,
  setToolPinned,
  toolAvailability,
  toolAvailabilityLabel,
  toolMachineStatusLabel,
  toolTaskStatusLabel,
} from './tool-catalog-selectors'

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

describe('tool catalog selectors', () => {
  it('groups in fixed source order and sorts stable literal names alphabetically', () => {
    const groups = selectToolCatalogGroups([
      entry('mcp:github:zeta', 'zeta', { kind: 'mcp', providerId: 'github' }),
      entry('codex:zeta', 'zeta', { kind: 'codex' }),
      entry('browser:runtime:web_search', 'web_search', { kind: 'browser', providerId: 'runtime' }),
      entry('cli:rg', 'rg', { kind: 'cli' }),
      entry('codex:apply_patch', 'apply_patch', { kind: 'codex' }),
      entry('mcp:github:alpha', 'alpha', { kind: 'mcp', providerId: 'github' }),
    ])

    expect(groups.map((group) => group.label)).toEqual([
      'Codex',
      'CLI',
      'Browser/Web',
      'Connected MCP',
    ])
    expect(groups[0].entries.map((tool) => tool.name)).toEqual(['apply_patch', 'zeta'])
    expect(groups[3].entries.map((tool) => tool.name)).toEqual(['alpha', 'zeta'])
  })

  it('keeps only rail members while retaining pinned orphan rows', () => {
    const groups = selectRailToolGroups([
      entry('cli:rg', 'rg', { kind: 'cli' }, { inRail: true }),
      entry('cli:jq', 'jq', { kind: 'cli' }),
      entry('mcp:missing:search', 'search', { kind: 'mcp', providerId: 'missing' }, {
        isPinned: true,
        inRail: true,
        isOrphan: true,
      }),
    ])

    expect(groups.flatMap((group) => group.entries.map((tool) => tool.id))).toEqual([
      'cli:rg',
      'mcp:missing:search',
    ])
  })

  it('provides truthful text labels and availability categories', () => {
    const signedOut = entry('cli:gh', 'gh', { kind: 'cli' }, {
      machine: {
        status: 'authentication-required',
        version: '2.0.0',
        observedAt: '2026-07-09T12:00:00.000Z',
        stale: false,
        provenance: 'local-probe',
        diagnosticCode: 'gh-auth-required',
      },
      task: {
        status: 'authentication-required',
        taskKey: { threadId: 'thread-1', capabilityEpoch: 'epoch-1' },
        observedAt: '2026-07-09T12:00:00.000Z',
        provenance: 'same-task-authentication',
      },
    })
    const orphan = entry('mcp:gone:search', 'search', { kind: 'mcp', providerId: 'gone' }, {
      isPinned: true,
      inRail: true,
      isOrphan: true,
    })

    expect(toolMachineStatusLabel(signedOut.machine.status)).toBe('Authentication required')
    expect(toolTaskStatusLabel(signedOut.task.status)).toBe('Authentication required')
    expect(toolAvailability(signedOut)).toBe('needs-attention')
    expect(toolAvailabilityLabel(orphan)).toBe('Provider unavailable')
    expect(toolAvailabilityLabel(entry('codex:exec_command', 'exec_command', { kind: 'codex' }))).toBe('Unavailable')
    expect(toolAvailabilityLabel(entry('cli:git', 'git', { kind: 'cli' }, {
      machine: { ...signedOut.machine, status: 'installed', diagnosticCode: null },
    }))).toBe('Ready')
    expect(toolAvailabilityLabel(entry('cli:rg', 'rg', { kind: 'cli' }, {
      machine: { ...signedOut.machine, status: 'installed', stale: true, diagnosticCode: 'probe-timeout' },
    }))).toBe('Refresh needed')
  })

  it('applies default dismissal and explicit pin semantics without losing orphan intent', () => {
    const defaultTool = entry('cli:rg', 'rg', { kind: 'cli' }, { isDefault: true, inRail: true })
    const optionalTool = entry('cli:jq', 'jq', { kind: 'cli' })
    const orphan = entry('mcp:gone:search', 'search', { kind: 'mcp', providerId: 'gone' }, {
      isPinned: true,
      inRail: true,
      isOrphan: true,
    })
    const initial = {
      pinnedToolIds: [orphan.id],
      dismissedDefaultToolIds: [] as string[],
    }

    const dismissed = setToolPinned(initial, defaultTool, false)
    expect(dismissed).toEqual({
      pinnedToolIds: [orphan.id],
      dismissedDefaultToolIds: [defaultTool.id],
    })
    expect(setToolPinned(dismissed, defaultTool, true)).toEqual(initial)

    const pinned = setToolPinned(initial, optionalTool, true)
    const visible = selectToolEntriesWithPreferences([defaultTool, optionalTool, orphan], pinned)
    expect(visible.find((tool) => tool.id === optionalTool.id)?.inRail).toBe(true)
    expect(visible.find((tool) => tool.id === orphan.id)?.inRail).toBe(true)

    const orphanRemoved = setToolPinned(initial, orphan, false)
    expect(selectToolEntriesWithPreferences([orphan], orphanRemoved)).toEqual([])
  })
})
