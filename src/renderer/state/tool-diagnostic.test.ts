import { describe, expect, it } from 'vitest'
import type { ToolCatalogEntry } from '@/shared/tools'
import { toolDiagnosticDraft } from './tool-diagnostic'

describe('toolDiagnosticDraft', () => {
  it('includes only normalized metadata', () => {
    const entry: ToolCatalogEntry = {
      id: 'codex:exec_command',
      name: 'exec_command',
      source: { kind: 'codex' },
      description: 'Runs a shell command.',
      isDefault: true,
      probeCapability: { kind: 'unsupported', reason: 'Runtime metadata only.' },
      isPinned: false,
      isDismissedDefault: false,
      inRail: true,
      isOrphan: false,
      machine: {
        status: 'available',
        version: null,
        observedAt: '2026-07-09T20:00:00.000Z',
        stale: false,
        provenance: 'active-task-inventory',
        diagnosticCode: 'approval-required',
      },
      task: {
        status: 'approval-required',
        taskKey: { threadId: 'thread-1', capabilityEpoch: 'epoch-1' },
        observedAt: '2026-07-09T20:00:00.000Z',
        provenance: 'same-task-approval',
      },
      activity: {
        outcome: 'approval-required',
        observedAt: '2026-07-09T20:00:00.000Z',
        callId: 'call-1',
        durationMs: 12,
      },
    }

    const draft = toolDiagnosticDraft(entry)
    expect(draft).toContain('Tool: exec_command')
    expect(draft).toContain('Task status: approval-required')
    expect(draft).toContain('Diagnostic code: approval-required')
    expect(draft).not.toContain('stdout')
    expect(draft).not.toContain('arguments')
    expect(draft).not.toContain('result')
  })
})
