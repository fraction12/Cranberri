export interface RuntimeMetricSummary {
  count: number
  p50: number | null
  p95: number | null
  maximum: number | null
}

export interface RuntimePerformanceReport {
  version: number
  metrics: Record<string, RuntimeMetricSummary>
}

export interface RuntimePerformanceContract {
  version: number
  budgets: Record<string, { statistic: keyof RuntimeMetricSummary; maximum: number }>
}

export function percentile(samples: number[], percentileValue: number): number | null
export function summarizeSamples(samples: number[]): RuntimeMetricSummary
export function compareRuntimePerformance(
  report: RuntimePerformanceReport,
  contract: RuntimePerformanceContract,
): { passed: boolean; violations: string[] }
