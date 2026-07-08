import type { CranberriDiagnosticsReport } from '@/shared/health'

export type DiagnosticsPathKey = 'app' | 'userData' | 'resources' | 'sqlite' | 'debugTelemetry' | 'electronLog'

export interface DiagnosticsPathRow {
  key: DiagnosticsPathKey
  label: string
  value: string
  actionable: boolean
}

export function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

export function diagnosticsPathRows(report: CranberriDiagnosticsReport): DiagnosticsPathRow[] {
  return [
    { key: 'app', label: 'App', value: report.paths.app, actionable: isAbsoluteLocalPath(report.paths.app) },
    { key: 'userData', label: 'User data', value: report.paths.userData, actionable: isAbsoluteLocalPath(report.paths.userData) },
    { key: 'resources', label: 'Resources', value: report.paths.resources, actionable: isAbsoluteLocalPath(report.paths.resources) },
    { key: 'sqlite', label: 'SQLite', value: report.paths.sqlite, actionable: isAbsoluteLocalPath(report.paths.sqlite) },
    { key: 'debugTelemetry', label: 'Telemetry JSONL', value: report.paths.debugTelemetry, actionable: isAbsoluteLocalPath(report.paths.debugTelemetry) },
    {
      key: 'electronLog',
      label: 'Electron log',
      value: report.paths.electronLog ?? 'Not initialized',
      actionable: report.paths.electronLog ? isAbsoluteLocalPath(report.paths.electronLog) : false,
    },
  ]
}

export function diagnosticsPathRowByKey(
  report: CranberriDiagnosticsReport,
  key: DiagnosticsPathKey,
): DiagnosticsPathRow | null {
  return diagnosticsPathRows(report).find((row) => row.key === key) ?? null
}
