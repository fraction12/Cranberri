import { describe, expect, it } from 'vitest'
import { usageChatContext } from './usage-chat-context'
import type { CodexAccountUsageReadResult, CodexRateLimitsReadResult } from '@/shared/codex'

function usage(overrides: Partial<CodexRateLimitsReadResult> = {}): CodexRateLimitsReadResult {
  const rateLimits: CodexRateLimitsReadResult['rateLimits'] = {
    limitId: 'primary',
    limitName: 'Pro usage',
    primary: {
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: Date.parse('2026-07-08T05:00:00.000Z') / 1000,
    },
    secondary: {
      usedPercent: 70,
      windowDurationMins: 10080,
      resetsAt: Date.parse('2026-07-15T00:00:00.000Z') / 1000,
    },
    credits: {
      hasCredits: true,
      unlimited: false,
      balance: '$12.34',
    },
    individualLimit: null,
    planType: 'pro',
    rateLimitReachedType: null,
  }

  return {
    rateLimits,
    rateLimitsByLimitId: { primary: rateLimits },
    rateLimitResetCredits: { availableCount: 2 },
    ...overrides,
  }
}

function accountUsage(overrides: Partial<CodexAccountUsageReadResult> = {}): CodexAccountUsageReadResult {
  return {
    summary: {
      lifetimeTokens: 1234567,
      peakDailyTokens: 345678,
      longestRunningTurnSec: 912,
      currentStreakDays: 3,
      longestStreakDays: 8,
    },
    dailyUsageBuckets: [
      { startDate: '2026-07-06', tokens: 12345 },
      { startDate: '2026-07-07', tokens: 98765 },
      { startDate: '2026-07-08', tokens: 45678 },
    ],
    ...overrides,
  }
}

describe('usage chat context', () => {
  it('formats primary and secondary rate-limit windows', () => {
    const context = usageChatContext(usage())

    expect(context).toContain('Codex usage context:')
    expect(context).toContain('- ID: primary')
    expect(context).toContain('- Name: Pro usage')
    expect(context).toContain('- Plan: pro')
    expect(context).toContain('Primary window:')
    expect(context).toContain('- Window: 5h')
    expect(context).toContain('- Used: 25%')
    expect(context).toContain('- Remaining: 75%')
    expect(context).toContain('- Resets: 2026-07-08T05:00:00.000Z')
    expect(context).toContain('Secondary window:')
    expect(context).toContain('- Window: weekly')
    expect(context).toContain('- Available: 2')
  })

  it('includes credits and alternate limits', () => {
    const base = usage().rateLimits
    const context = usageChatContext(usage({
      rateLimitsByLimitId: {
        primary: base,
        extra: { ...base, limitId: 'extra', limitName: 'Team pool', planType: 'team' },
      },
    }))

    expect(context).toContain('- Has credits: true')
    expect(context).toContain('- Unlimited: false')
    expect(context).toContain('- Balance: $12.34')
    expect(context).toContain('- extra: Team pool (team)')
  })

  it('includes account usage history when provided', () => {
    const context = usageChatContext(usage(), accountUsage())

    expect(context).toContain('Account usage history:')
    expect(context).toContain('- Lifetime tokens: 1,234,567')
    expect(context).toContain('- Peak daily tokens: 345,678')
    expect(context).toContain('- Longest running turn: 912s')
    expect(context).toContain('- Current streak: 3d')
    expect(context).toContain('Recent daily usage:')
    expect(context).toContain('- 2026-07-07: 98,765 tokens')
  })

  it('reports unavailable account usage when not provided', () => {
    const context = usageChatContext(usage())

    expect(context).toContain('Account usage history:')
    expect(context).toContain('- unavailable')
  })

  it('bounds oversized usage details while keeping the newest tail', () => {
    const base = usage().rateLimits
    const rateLimitsByLimitId = Object.fromEntries([
      ['primary', base],
      ...Array.from({ length: 80 }, (_, index) => [
        `limit-${index}`,
        {
          ...base,
          limitId: `limit-${index}`,
          limitName: `${'x'.repeat(600)} latest-usage-detail-${index}`,
        },
      ]),
    ])

    const context = usageChatContext(usage({ rateLimitsByLimitId }))

    expect(context).toContain('Codex usage context:')
    expect(context).toContain('Usage context truncated')
    expect(context).toContain('latest-usage-detail')
  })
})
