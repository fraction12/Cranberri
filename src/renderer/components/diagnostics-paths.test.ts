import { describe, expect, it } from 'vitest'
import { diagnosticsPathRowByKey, diagnosticsPathRows, isAbsoluteLocalPath } from './diagnostics-paths'
import type { CranberriDiagnosticsReport } from '@/shared/health'

const REPORT: CranberriDiagnosticsReport = {
  checkedAt: 1,
  build: {
    commit: 'abc1234',
    branch: 'main',
    commitTime: '2026-07-08T00:00:00.000Z',
    buildTime: '2026-07-08T00:00:01.000Z',
    version: '0.1.3',
    packaged: false,
    channel: 'development',
    schemas: { appState: 3, taskStore: 2, composerDrafts: 1 },
  },
  runtime: {
    platform: 'darwin',
    arch: 'arm64',
    electron: '42.0.0',
    node: '22.0.0',
    chrome: '142.0.0',
    v8: '14.2.0',
    packaged: false,
  },
  paths: {
    app: '/Applications/Cranberri.app',
    userData: '/Users/example/Library/Application Support/Cranberri',
    resources: '/Applications/Cranberri.app/Contents/Resources',
    sqlite: '/Users/example/Library/Application Support/Cranberri/cranberri.sqlite',
    debugTelemetry: '/Users/example/Library/Application Support/Cranberri/telemetry.jsonl',
    electronLog: null,
  },
  health: {
    checkedAt: 1,
    level: 'ok',
    checks: [],
  },
  nativeHelpers: [],
  recentEvents: [],
}

describe('diagnostics paths', () => {
  it('recognizes absolute local paths across supported desktop formats', () => {
    expect(isAbsoluteLocalPath('/Users/example/Cranberri')).toBe(true)
    expect(isAbsoluteLocalPath('C:\\Users\\example\\Cranberri')).toBe(true)
    expect(isAbsoluteLocalPath('README.md')).toBe(false)
    expect(isAbsoluteLocalPath('Not initialized')).toBe(false)
  })

  it('marks real diagnostic paths actionable and placeholders inert', () => {
    const rows = diagnosticsPathRows(REPORT)

    expect(rows.find((row) => row.label === 'User data')).toMatchObject({
      key: 'userData',
      value: '/Users/example/Library/Application Support/Cranberri',
      actionable: true,
    })
    expect(rows.find((row) => row.label === 'Electron log')).toMatchObject({
      key: 'electronLog',
      value: 'Not initialized',
      actionable: false,
    })
  })

  it('finds diagnostic paths by stable command keys', () => {
    expect(diagnosticsPathRowByKey(REPORT, 'sqlite')).toMatchObject({
      label: 'SQLite',
      value: '/Users/example/Library/Application Support/Cranberri/cranberri.sqlite',
      actionable: true,
    })
    expect(diagnosticsPathRowByKey(REPORT, 'electronLog')).toMatchObject({
      label: 'Electron log',
      actionable: false,
    })
  })
})
