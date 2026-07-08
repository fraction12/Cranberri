import type { BuildInfo } from './buildInfo'
import type { NativeHelperStatus } from './nativeHelpers'
import type { TelemetryEventRecord } from './telemetry'

export type CranberriHealthLevel = 'ok' | 'warning' | 'error'

export interface CranberriHealthCheck {
  id: string
  label: string
  level: CranberriHealthLevel
  detail: string
  fixAvailable?: boolean
}

export interface CranberriHealthReport {
  level: CranberriHealthLevel
  checkedAt: number
  checks: CranberriHealthCheck[]
}

export interface CranberriDiagnosticsReport {
  checkedAt: number
  health: CranberriHealthReport
  build: BuildInfo
  runtime: {
    platform: string
    arch: string
    electron: string
    chrome: string
    node: string
    v8: string
    packaged: boolean
  }
  paths: {
    app: string
    userData: string
    resources: string
    debugTelemetry: string
    electronLog: string | null
    sqlite: string
  }
  nativeHelpers: NativeHelperStatus[]
  recentEvents: TelemetryEventRecord[]
}
