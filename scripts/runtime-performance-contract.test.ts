import { describe, expect, it } from 'vitest'
import contract from './runtime-performance-budgets.json'
import {
  compareRuntimePerformance,
  percentile,
  summarizeSamples,
} from './runtime-performance-contract.mjs'

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
    const passingMetrics = Object.fromEntries(Object.entries(contract.budgets).map(([name, budget]) => [
      name,
      { count: 20, p50: budget.maximum / 2, p95: budget.maximum, maximum: budget.maximum },
    ]))
    expect(compareRuntimePerformance({ version: 1, metrics: passingMetrics }, contract)).toEqual({
      passed: true,
      violations: [],
    })

    const missing = compareRuntimePerformance({ version: 1, metrics: {} }, contract)
    expect(missing.passed).toBe(false)
    expect(missing.violations).toContain('launchToUsableMs was not measured')

    const overBudget = compareRuntimePerformance({
      version: 1,
      metrics: {
        ...passingMetrics,
        composerKeyToPaintMs: { count: 20, p50: 20, p95: 51, maximum: 51 },
      },
    }, contract)
    expect(overBudget.violations).toContain('composerKeyToPaintMs.p95 51 exceeds 50')

    expect(compareRuntimePerformance({ version: 2, metrics: passingMetrics }, contract).passed).toBe(false)
  })
})
