import { describe, expect, it } from 'vitest'
import { diagnosticsChatContext } from './diagnostics-chat-context'
import type { CranberriDiagnosticsReport } from '@/shared/health'

function diagnostics(overrides: Partial<CranberriDiagnosticsReport> = {}): CranberriDiagnosticsReport {
  return {
    checkedAt: Date.parse('2026-07-08T00:00:00.000Z'),
    health: {
      level: 'warning',
      checkedAt: Date.parse('2026-07-08T00:00:00.000Z'),
      checks: [
        { id: 'node', label: 'Node runtime', level: 'ok', detail: 'v22.13.1' },
        { id: 'codex-cli', label: 'Codex CLI', level: 'warning', detail: 'codex unavailable', fixAvailable: true },
      ],
    },
    build: {
      version: '0.1.3',
      commit: 'abc123',
      branch: 'main',
      commitTime: '2026-07-07T20:00:00.000Z',
      buildTime: '2026-07-08T00:00:00.000Z',
      packaged: false,
      channel: 'development',
      schemas: { appState: 3, taskStore: 2, composerDrafts: 1 },
    },
    runtime: {
      platform: 'darwin',
      arch: 'arm64',
      electron: '42.6.0',
      chrome: '142.0.0.0',
      node: '22.13.1',
      v8: '14.2',
      packaged: false,
    },
    paths: {
      app: '/repo/cranberri',
      userData: '/tmp/user-data',
      resources: '/repo/cranberri',
      debugTelemetry: '/tmp/telemetry.jsonl',
      electronLog: '/tmp/main.log',
      sqlite: '/tmp/cranberri.sqlite',
    },
    nativeHelpers: [
      { id: 'apple-script', label: 'AppleScript helper', availability: 'available', detail: 'osascript is available' },
    ],
    recentEvents: [
      {
        id: 1,
        timestamp: '2026-07-08T00:00:00.000Z',
        source: 'codex',
        type: 'event',
        payload: {
          message: 'started',
          apiToken: 'secret-value',
          nested: { password: 'nope', ok: true },
        },
      },
    ],
    ...overrides,
  }
}

describe('diagnostics chat context', () => {
  it('formats health, runtime, paths, helpers, and recent events', () => {
    const context = diagnosticsChatContext(diagnostics())

    expect(context).toContain('Cranberri diagnostics context:')
    expect(context).toContain('Health: warning')
    expect(context).toContain('Version: 0.1.3')
    expect(context).toContain('Platform: darwin/arm64')
    expect(context).toContain('User data: /tmp/user-data')
    expect(context).toContain('- [ok] Node runtime: v22.13.1')
    expect(context).toContain('fix available: yes')
    expect(context).toContain('- AppleScript helper: available')
    expect(context).toContain('#1 2026-07-08T00:00:00.000Z codex:event')
  })

  it('redacts sensitive payload keys', () => {
    const context = diagnosticsChatContext(diagnostics())

    expect(context).toContain('"apiToken":"[redacted]"')
    expect(context).toContain('"password":"[redacted]"')
    expect(context).not.toContain('secret-value')
    expect(context).not.toContain('nope')
  })

  it('bounds oversized diagnostics while keeping the newest tail', () => {
    const context = diagnosticsChatContext(diagnostics({
      health: {
        level: 'warning',
        checkedAt: Date.parse('2026-07-08T00:00:00.000Z'),
        checks: Array.from({ length: 80 }, (_, index) => ({
          id: `check-${index}`,
          label: `Large check ${index}`,
          level: 'warning' as const,
          detail: `detail-${index} ${'x'.repeat(300)}`,
        })),
      },
      recentEvents: [{
        id: 99,
        timestamp: '2026-07-08T00:01:00.000Z',
        source: 'renderer',
        type: 'large',
        payload: { message: 'latest-diagnostic-detail' },
      }],
    }))

    expect(context).toContain('Cranberri diagnostics context:')
    expect(context).toContain('Diagnostics context truncated')
    expect(context).toContain('latest-diagnostic-detail')
  })
})
