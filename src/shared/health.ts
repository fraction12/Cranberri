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
