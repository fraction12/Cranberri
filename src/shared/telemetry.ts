export interface TelemetryEventRecord {
  id: number
  timestamp: string
  source: string
  type: string
  payload: unknown
}
