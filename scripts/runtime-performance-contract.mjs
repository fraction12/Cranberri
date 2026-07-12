export function percentile(samples, percentileValue) {
  const values = samples.filter(Number.isFinite).sort((left, right) => left - right)
  if (values.length === 0) return null
  const rank = Math.max(0, Math.ceil((percentileValue / 100) * values.length) - 1)
  return values[Math.min(rank, values.length - 1)]
}

export function summarizeSamples(samples) {
  const values = samples.filter(Number.isFinite)
  if (values.length === 0) return { count: 0, p50: null, p95: null, maximum: null }
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    maximum: Math.max(...values),
  }
}

export function compareRuntimePerformance(report, contract) {
  if (report.version !== contract.version) {
    return {
      passed: false,
      violations: [`Report version ${report.version} does not match budget version ${contract.version}`],
    }
  }

  const violations = []
  for (const [metricName, budget] of Object.entries(contract.budgets)) {
    const summary = report.metrics?.[metricName]
    if (!summary) {
      violations.push(`${metricName} was not measured`)
      continue
    }
    const value = summary[budget.statistic]
    if (!Number.isFinite(value)) {
      violations.push(`${metricName}.${budget.statistic} is not finite`)
      continue
    }
    if (value > budget.maximum) {
      violations.push(`${metricName}.${budget.statistic} ${formatNumber(value)} exceeds ${formatNumber(budget.maximum)}`)
    }
  }

  return { passed: violations.length === 0, violations }
}

function formatNumber(value) {
  return Number(value.toFixed(3))
}
