const TOOLTIP_CLASS = 'pointer-events-none absolute bottom-6 left-1/2 z-[1200] w-[165px] -translate-x-1/2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-center text-xs text-[var(--app-text)] opacity-0 shadow-2xl shadow-black/50 transition-opacity group-hover:opacity-100'

export function ContextWindowIndicator({
  usedTokens,
  contextWindow = 258400,
}: {
  usedTokens: number
  contextWindow?: number
}) {
  const percentUsed = Math.min(100, Math.round((usedTokens / contextWindow) * 100))
  const percentLeft = Math.max(0, 100 - percentUsed)
  const compactUsed = `${Math.round(usedTokens / 1000)}k`
  const compactTotal = `${Math.round(contextWindow / 1000)}k`
  const fillDegrees = Math.round((percentUsed / 100) * 360)

  return (
    <div className="group relative flex h-5 w-5 items-center justify-center text-[var(--app-text-muted)]">
      <div
        className="flex h-3 w-3 items-center justify-center rounded-full"
        style={{
          background: percentUsed === 0
            ? 'transparent'
            : `conic-gradient(var(--app-text) ${fillDegrees}deg, rgba(127,135,148,0.35) ${fillDegrees}deg)`,
          boxShadow: percentUsed === 0 ? 'inset 0 0 0 2px rgba(127,135,148,0.35)' : 'none',
        }}
      >
        {percentUsed > 0 && <div className="h-1.5 w-1.5 rounded-full bg-[var(--app-surface)]" />}
      </div>
      <div className={TOOLTIP_CLASS}>
        <div className="mb-1 text-xs text-[var(--app-text-muted)]">Context window:</div>
        <div>{percentUsed}% used ({percentLeft}% left)</div>
        <div>{compactUsed} / {compactTotal} tokens used</div>
      </div>
    </div>
  )
}
