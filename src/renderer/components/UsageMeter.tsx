import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Gauge, Loader2 } from 'lucide-react'
import type { CodexAccountUsageReadResult, CodexRateLimitWindow, CodexRateLimitsReadResult } from '@/shared/codex'

function windowLabel(window?: CodexRateLimitWindow): string {
  if (!window) return '—'
  const mins = window.windowDurationMins
  if (mins === 0) return '—'
  if (mins % 10080 === 0) return 'Weekly'
  if (mins % 1440 === 0) return `${mins / 1440}d`
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${mins}m`
}

function formatRemaining(usedPercent: number): string {
  return `${Math.max(0, 100 - usedPercent)}%`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatResetsAt(resetsAtSeconds: number): string {
  const date = new Date(resetsAtSeconds * 1000)
  const now = new Date()
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(Math.round(tokens))
}

function RateLimitRow({ window }: { window?: CodexRateLimitWindow }) {
  if (!window) return null
  const remaining = Math.max(0, 100 - window.usedPercent)
  const low = remaining <= 20
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-app-text">{windowLabel(window)}</span>
      <div className="flex items-center gap-2">
        <span className={low ? 'text-app-danger' : 'text-app-text'}>{formatRemaining(window.usedPercent)}</span>
        <span className="text-app-text-muted">{formatResetsAt(window.resetsAt)}</span>
      </div>
    </div>
  )
}

function DailyUsageBars({ usage }: { usage: CodexAccountUsageReadResult | null }) {
  if (!usage) return null
  const buckets = usage.dailyUsageBuckets.slice(-7)
  if (buckets.length === 0) return (
    <div className="text-caption text-app-text-muted">No daily usage history yet.</div>
  )
  const peak = Math.max(...buckets.map((bucket) => bucket.tokens), 1)
  return (
    <div className="space-y-1.5">
      {buckets.map((bucket) => {
        const width = Math.max(4, Math.round((bucket.tokens / peak) * 100))
        return (
          <div key={bucket.startDate} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-caption">
            <span className="truncate text-app-text-muted">{bucket.startDate}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-app-surface-2">
              <div className="h-full rounded-full bg-app-accent" style={{ width: `${width}%` }} />
            </div>
            <span className="text-right text-app-text">{formatTokenCount(bucket.tokens)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function UsageMeter({ className = '' }: { className?: string }) {
  const [data, setData] = useState<CodexRateLimitsReadResult | null>(null)
  const [accountUsage, setAccountUsage] = useState<CodexAccountUsageReadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)

  const fetchLimits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [limitsResult, usageResult] = await Promise.all([
        window.cranberri.codex.getRateLimits(),
        window.cranberri.codex.getAccountUsage(),
      ])
      setData(limitsResult)
      setAccountUsage(usageResult)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      console.error('Failed to load Codex rate limits:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLimits()
    const id = window.setInterval(fetchLimits, 30_000)
    return () => window.clearInterval(id)
  }, [fetchLimits])

  const availableResets = data?.rateLimitResetCredits?.availableCount ?? 0
  const primary = data?.rateLimits?.primary
  const secondary = data?.rateLimits?.secondary

  const handleClaim = async () => {
    if (availableResets <= 0) return
    setClaiming(true)
    setError(null)
    try {
      await window.cranberri.codex.consumeRateLimitResetCredit()
      setConfirmOpen(false)
      setPanelOpen(false)
      await fetchLimits()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      console.error('Failed to claim rate-limit reset:', err)
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className={`shrink-0 p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-app-text">
        <Gauge className="h-3.5 w-3.5 text-app-text-muted" />
        <span>Usage remaining</span>
        {loading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-app-text-muted" />}
      </div>

      {error && !data && (
        <div className="text-caption text-app-text-muted">Usage unavailable</div>
      )}

      {data && (
        <>
          <RateLimitRow window={primary} />
          <RateLimitRow window={secondary} />
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="mt-1 flex w-full items-center justify-between py-1 text-xs text-app-text-muted hover:text-app-text"
          >
            <span>{availableResets} reset{availableResets === 1 ? '' : 's'} available</span>
            <ChevronRight className={`h-3 w-3 transition-transform ${panelOpen ? 'rotate-90' : ''}`} />
          </button>
          {panelOpen && (
            <div className="mt-2 space-y-1 border-t border-app-border pt-2">
              {primary && (
                <div className="flex items-center justify-between text-caption text-app-text-muted">
                  <span>Primary resets</span>
                  <span>{formatResetsAt(primary.resetsAt)}</span>
                </div>
              )}
              {secondary && (
                <div className="flex items-center justify-between text-caption text-app-text-muted">
                  <span>Weekly resets</span>
                  <span>{formatResetsAt(secondary.resetsAt)}</span>
                </div>
              )}
              {accountUsage && (
                <div className="space-y-2 border-t border-app-border pt-2">
                  <div className="flex items-center justify-between text-caption text-app-text-muted">
                    <span>Lifetime tokens</span>
                    <span className="text-app-text">{formatTokenCount(accountUsage.summary.lifetimeTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between text-caption text-app-text-muted">
                    <span>Current streak</span>
                    <span className="text-app-text">{accountUsage.summary.currentStreakDays}d</span>
                  </div>
                  <DailyUsageBars usage={accountUsage} />
                </div>
              )}
              <button
                type="button"
                disabled={availableResets <= 0 || claiming}
                onClick={() => setConfirmOpen(true)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface-2 px-2 py-1.5 text-xs font-medium text-app-text hover:bg-app-border disabled:opacity-40"
              >
                {claiming ? 'Claiming…' : 'Claim 1 reset'}
              </button>
              {error && <div className="text-caption text-app-danger">{error}</div>}
            </div>
          )}
        </>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-overlay)]"
          onClick={() => !claiming && setConfirmOpen(false)}
        >
          <div
            className="w-[340px] rounded-xl border border-app-border bg-app-surface p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-medium text-app-text">Claim rate-limit reset?</div>
            <div className="mt-1 text-xs text-app-text-muted">
              This consumes <strong>one whole reset</strong>. You will have{' '}
              <strong>{Math.max(0, availableResets - 1)}</strong> remaining afterward. This cannot be undone.
            </div>
            {error && <div className="mt-2 text-xs text-app-danger">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={claiming}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={claiming || availableResets <= 0}
                onClick={handleClaim}
                className="rounded-lg border border-app-border bg-app-surface-2 px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-border disabled:opacity-50"
              >
                {claiming ? 'Claiming…' : 'Claim reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
