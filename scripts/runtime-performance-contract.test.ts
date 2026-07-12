import { describe, expect, it } from 'vitest'
import contract from './runtime-performance-budgets.json'
import {
  compareRuntimePerformance,
  percentile,
  summarizeSamples,
} from './runtime-performance-contract.mjs'

const minimumSamples: Record<string, number> = {
  launchToUsableMs: 3,
  workspaceCoherentMs: 3,
  windowSwitchCoherentMs: 50,
  rightRailRefreshMs: 1,
  composerKeyToPaintMs: 20,
  longTaskMs: 0,
  idleCpuPercent: 10,
  retainedMemoryGrowthPercent: 1,
}

function passingReport() {
  const samples = Object.fromEntries(Object.entries(contract.budgets).map(([name, budget]) => [
    name,
    Array.from({ length: minimumSamples[name] }, () => budget.maximum / 2),
  ]))
  const metrics = Object.fromEntries(Object.entries(samples).map(([name, values]) => [
    name,
    summarizeSamples(values),
  ]))
  metrics.longTaskMs.maximum = 0

  return {
    version: 1,
    fixture: { launchLoops: 3, switchLoops: 50, projectCount: 3, checkoutCount: 3 },
    samples,
    metrics,
    instrumentation: {
      longTasks: {
        available: true,
        observationWindowMs: 10_000,
        entryCount: 0,
        maximumObservedMs: 0,
      },
    },
    endurance: {
      identityChecks: 50,
      identityMismatches: [],
      projectIds: ['project-1', 'project-2', 'project-3'],
      checkoutIds: ['checkout-1', 'checkout-2', 'checkout-3'],
    },
  }
}

describe('runtime performance contract', () => {
  it('uses nearest-rank percentiles so tail regressions stay visible', () => {
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
    expect(percentile([], 95)).toBeNull()
  })

  it('summarizes finite samples without hiding invalid measurements', () => {
    expect(summarizeSamples([4, Number.NaN, 2, 8])).toEqual({
      count: 3,
      p50: 4,
      p95: 8,
      maximum: 8,
    })
  })

  it('fails closed for missing, invalid, over-budget, or incompatible metrics', () => {
    const passing = passingReport()
    expect(compareRuntimePerformance(passing, contract)).toEqual({
      passed: true,
      violations: [],
    })

    const missing = compareRuntimePerformance({ ...passing, metrics: {} }, contract)
    expect(missing.passed).toBe(false)
    expect(missing.violations).toContain('launchToUsableMs was not measured')

    const overBudget = compareRuntimePerformance({
      ...passing,
      metrics: {
        ...passing.metrics,
        composerKeyToPaintMs: { count: 20, p50: 20, p95: 51, maximum: 51 },
      },
    }, contract)
    expect(overBudget.violations).toContain('composerKeyToPaintMs.p95 51 exceeds 50')

    expect(compareRuntimePerformance({ ...passing, version: 2 }, contract).passed).toBe(false)
  })

  it('rejects undersampled or internally inconsistent measurements', () => {
    const passing = passingReport()
    const undersampled = compareRuntimePerformance({
      ...passing,
      samples: { ...passing.samples, launchToUsableMs: [100, 110] },
      metrics: {
        ...passing.metrics,
        launchToUsableMs: summarizeSamples([100, 110]),
      },
    }, contract)
    expect(undersampled.violations).toContain('launchToUsableMs requires at least 3 finite samples; received 2')

    const inconsistent = compareRuntimePerformance({
      ...passing,
      metrics: {
        ...passing.metrics,
        idleCpuPercent: { ...passing.metrics.idleCpuPercent, count: 99 },
      },
    }, contract)
    expect(inconsistent.violations).toContain('idleCpuPercent summary count 99 does not match 10 finite samples')
  })

  it('requires available long-task instrumentation and measured endurance identity', () => {
    const passing = passingReport()
    const unavailable = compareRuntimePerformance({
      ...passing,
      instrumentation: { longTasks: { ...passing.instrumentation.longTasks, available: false } },
    }, contract)
    expect(unavailable.violations).toContain('long-task instrumentation was unavailable')

    const incompleteEndurance = compareRuntimePerformance({
      ...passing,
      endurance: {
        identityChecks: 49,
        identityMismatches: [{ expectedProjectId: 'project-1', actualProjectId: 'project-2' }],
        projectIds: ['project-1', 'project-2'],
        checkoutIds: ['checkout-1', 'checkout-2'],
      },
    }, contract)
    expect(incompleteEndurance.violations).toEqual(expect.arrayContaining([
      'runtime fixture requires at least 3 projects; received 2 verified identities',
      'runtime fixture requires at least 3 checkouts; received 2 verified identities',
      'endurance identity checks require at least 50 switches; received 49',
      'endurance identity checks found 1 mismatch',
    ]))
  })
})
