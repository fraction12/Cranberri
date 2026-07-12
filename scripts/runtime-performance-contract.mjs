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

export const RUNTIME_MINIMUM_SAMPLE_COUNTS = Object.freeze({
  launchToUsableMs: 3,
  workspaceCoherentMs: 3,
  windowSwitchCoherentMs: 50,
  rightRailRefreshMs: 1,
  composerKeyToPaintMs: 20,
  longTaskMs: 0,
  idleCpuPercent: 10,
  retainedMemoryGrowthPercent: 1,
})

export function compareRuntimePerformance(report, contract) {
  if (report.version !== contract.version) {
    return {
      passed: false,
      violations: [`Report version ${report.version} does not match budget version ${contract.version}`],
    }
  }

  const violations = []
  validateEnduranceIdentity(report, violations)
  validateLongTaskInstrumentation(report, violations)

  for (const [metricName, budget] of Object.entries(contract.budgets)) {
    const summary = report.metrics?.[metricName]
    if (!summary) {
      violations.push(`${metricName} was not measured`)
      continue
    }

    const samples = report.samples?.[metricName]
    if (!Array.isArray(samples)) {
      violations.push(`${metricName} samples were not recorded`)
      continue
    }
    const finiteSamples = samples.filter(Number.isFinite)
    if (finiteSamples.length !== samples.length) {
      violations.push(`${metricName} contains ${samples.length - finiteSamples.length} non-finite sample`)
    }
    const minimumSamples = RUNTIME_MINIMUM_SAMPLE_COUNTS[metricName] ?? 1
    if (finiteSamples.length < minimumSamples) {
      violations.push(`${metricName} requires at least ${minimumSamples} finite samples; received ${finiteSamples.length}`)
    }
    if (summary.count !== finiteSamples.length) {
      violations.push(`${metricName} summary count ${summary.count} does not match ${finiteSamples.length} finite samples`)
    }

    const measured = summarizeSamples(finiteSamples)
    for (const statistic of ['p50', 'p95', 'maximum']) {
      const expected = metricName === 'longTaskMs' && statistic === 'maximum'
        ? report.instrumentation?.longTasks?.maximumObservedMs
        : measured[statistic]
      if (summary[statistic] !== expected) {
        violations.push(`${metricName}.${statistic} ${formatValue(summary[statistic])} does not match samples ${formatValue(expected)}`)
      }
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

function validateLongTaskInstrumentation(report, violations) {
  const instrumentation = report.instrumentation?.longTasks
  if (instrumentation?.available !== true) {
    violations.push('long-task instrumentation was unavailable')
    return
  }
  if (!Number.isFinite(instrumentation.observationWindowMs) || instrumentation.observationWindowMs <= 0) {
    violations.push('long-task instrumentation did not record a valid observation window')
  }
  if (!Number.isInteger(instrumentation.entryCount) || instrumentation.entryCount < 0) {
    violations.push('long-task instrumentation did not record a valid entry count')
  }
  if (!Number.isFinite(instrumentation.maximumObservedMs) || instrumentation.maximumObservedMs < 0) {
    violations.push('long-task instrumentation did not record a valid observed maximum')
  }
  const samples = report.samples?.longTaskMs
  if (Array.isArray(samples) && instrumentation.entryCount !== samples.filter(Number.isFinite).length) {
    violations.push(`long-task instrumentation entry count ${instrumentation.entryCount} does not match recorded samples`)
  }
  if (Array.isArray(samples)) {
    const finiteSamples = samples.filter(Number.isFinite)
    const expectedMaximum = finiteSamples.length > 0 ? Math.max(...finiteSamples) : 0
    if (instrumentation.maximumObservedMs !== expectedMaximum) {
      violations.push(`long-task instrumentation maximum ${formatValue(instrumentation.maximumObservedMs)} does not match recorded samples ${formatValue(expectedMaximum)}`)
    }
  }
}

function validateEnduranceIdentity(report, violations) {
  const endurance = report.endurance
  const projectCount = uniqueStringCount(endurance?.projectIds)
  const checkoutCount = uniqueStringCount(endurance?.checkoutIds)
  if (projectCount < 3) {
    violations.push(`runtime fixture requires at least 3 projects; received ${projectCount} verified identities`)
  }
  if (checkoutCount < 3) {
    violations.push(`runtime fixture requires at least 3 checkouts; received ${checkoutCount} verified identities`)
  }
  const identityChecks = Number.isInteger(endurance?.identityChecks) ? endurance.identityChecks : 0
  if (identityChecks < 50) {
    violations.push(`endurance identity checks require at least 50 switches; received ${identityChecks}`)
  }
  const mismatchCount = Array.isArray(endurance?.identityMismatches) ? endurance.identityMismatches.length : 0
  if (mismatchCount > 0) {
    violations.push(`endurance identity checks found ${mismatchCount} mismatch${mismatchCount === 1 ? '' : 'es'}`)
  }
  const measuredSwitches = Array.isArray(report.samples?.windowSwitchCoherentMs)
    ? report.samples.windowSwitchCoherentMs.filter(Number.isFinite).length
    : 0
  if (identityChecks !== measuredSwitches + mismatchCount) {
    violations.push(`endurance identity check count ${identityChecks} does not match ${measuredSwitches} measured switches and ${mismatchCount} mismatches`)
  }
  const plannedSwitches = Number.isInteger(report.fixture?.switchLoops) ? report.fixture.switchLoops : 0
  if (plannedSwitches < 50 || identityChecks < plannedSwitches) {
    violations.push(`endurance run completed ${identityChecks} of ${Math.max(50, plannedSwitches)} planned identity checks`)
  }
  if (report.fixture?.projectCount !== projectCount || report.fixture?.checkoutCount !== checkoutCount) {
    violations.push('runtime fixture identity metadata does not match verified project and checkout identities')
  }
}

function uniqueStringCount(values) {
  return new Set(Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value) : []).size
}

function formatNumber(value) {
  return Number(value.toFixed(3))
}

function formatValue(value) {
  return Number.isFinite(value) ? formatNumber(value) : String(value)
}
