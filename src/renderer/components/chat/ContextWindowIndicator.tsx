import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { Tooltip } from '../ui/Tooltip'

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
  const label = `${percentUsed}% of context used, ${percentLeft}% left`
  const details = (
    <>
      <div className={typeStyle({ role: 'label', tone: 'secondary' })}>Context window</div>
      <div className={cn(typeStyle({ role: 'status' }), 'mt-1')}>{percentUsed}% used · {percentLeft}% left</div>
      <div className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-0.5')}>{compactUsed} / {compactTotal} tokens</div>
    </>
  )

  return (
    <Tooltip content={details} contentClassName="w-44 px-3 py-2 text-center">
      <button type="button" className="flex h-5 w-5 items-center justify-center rounded-full text-app-text-muted" aria-label={label}>
        <span
          className="flex h-3 w-3 items-center justify-center rounded-full"
          style={{
            background: percentUsed === 0
              ? 'transparent'
              : `conic-gradient(var(--app-text) ${fillDegrees}deg, rgba(127,135,148,0.35) ${fillDegrees}deg)`,
            boxShadow: percentUsed === 0 ? 'inset 0 0 0 2px rgba(127,135,148,0.35)' : 'none',
          }}
        >
          {percentUsed > 0 && <span className="h-1.5 w-1.5 rounded-full bg-app-surface" />}
        </span>
      </button>
    </Tooltip>
  )
}
