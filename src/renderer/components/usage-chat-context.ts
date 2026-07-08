import type { CodexAccountUsageReadResult, CodexRateLimitsReadResult, CodexRateLimitWindow } from '@/shared/codex'

const MAX_USAGE_CONTEXT_CHARS = 10000

function truncateMiddle(value: string, maxChars = MAX_USAGE_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const keep = Math.floor((maxChars - 90) / 2)
  return [
    text.slice(0, keep).trimEnd(),
    '',
    `[Usage context truncated: ${text.length - (keep * 2)} chars omitted from the middle]`,
    '',
    text.slice(-keep).trimStart(),
  ].join('\n')
}

function windowLabel(window: CodexRateLimitWindow): string {
  const mins = window.windowDurationMins
  if (mins === 0) return 'unknown window'
  if (mins % 10080 === 0) return 'weekly'
  if (mins % 1440 === 0) return `${mins / 1440}d`
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${mins}m`
}

function resetTime(resetsAtSeconds: number): string {
  if (!Number.isFinite(resetsAtSeconds) || resetsAtSeconds <= 0) return 'unknown'
  return new Date(resetsAtSeconds * 1000).toISOString()
}

function formatWindow(label: string, window: CodexRateLimitWindow): string {
  const remaining = Math.max(0, 100 - window.usedPercent)
  return [
    `${label}:`,
    `- Window: ${windowLabel(window)}`,
    `- Used: ${window.usedPercent}%`,
    `- Remaining: ${remaining}%`,
    `- Resets: ${resetTime(window.resetsAt)}`,
  ].join('\n')
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'unknown'
}

function formatAccountUsage(accountUsage: CodexAccountUsageReadResult | null | undefined): string {
  if (!accountUsage) return 'Account usage history:\n- unavailable'
  const buckets = accountUsage.dailyUsageBuckets
    .slice(-14)
    .map((bucket) => `- ${bucket.startDate}: ${formatNumber(bucket.tokens)} tokens`)
    .join('\n')
  return [
    'Account usage history:',
    `- Lifetime tokens: ${formatNumber(accountUsage.summary.lifetimeTokens)}`,
    `- Peak daily tokens: ${formatNumber(accountUsage.summary.peakDailyTokens)}`,
    `- Longest running turn: ${formatNumber(accountUsage.summary.longestRunningTurnSec)}s`,
    `- Current streak: ${formatNumber(accountUsage.summary.currentStreakDays)}d`,
    `- Longest streak: ${formatNumber(accountUsage.summary.longestStreakDays)}d`,
    '',
    'Recent daily usage:',
    buckets || '- none',
  ].join('\n')
}

export function usageChatContext(data: CodexRateLimitsReadResult, accountUsage?: CodexAccountUsageReadResult | null): string {
  const limit = data.rateLimits
  const alternateLimits = Object.entries(data.rateLimitsByLimitId)
    .filter(([limitId]) => limitId !== limit.limitId)
    .slice(0, 20)
    .map(([limitId, item]) => `- ${limitId}: ${item.limitName ?? 'unnamed'} (${item.planType})`)
    .join('\n')
  const credits = limit.credits
  const body = [
    'Codex usage context:',
    '',
    'Current limit:',
    `- ID: ${limit.limitId}`,
    `- Name: ${limit.limitName ?? 'unnamed'}`,
    `- Plan: ${limit.planType}`,
    limit.rateLimitReachedType ? `- Reached: ${limit.rateLimitReachedType}` : '- Reached: no',
    '',
    formatWindow('Primary window', limit.primary),
    '',
    formatWindow('Secondary window', limit.secondary),
    '',
    'Credits:',
    credits
      ? [
        `- Has credits: ${credits.hasCredits}`,
        `- Unlimited: ${credits.unlimited}`,
        `- Balance: ${credits.balance}`,
      ].join('\n')
      : '- none',
    '',
    'Reset credits:',
    `- Available: ${data.rateLimitResetCredits.availableCount}`,
    '',
    'Other limits:',
    alternateLimits || '- none',
    '',
    formatAccountUsage(accountUsage),
  ].join('\n')

  return truncateMiddle(body)
}
