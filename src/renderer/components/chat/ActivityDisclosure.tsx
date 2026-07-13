import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

const DEFAULT_PREVIEW_LENGTH = 140

function jsonReplacer() {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`
    if (typeof value === 'symbol') return String(value)
    if (value instanceof Error) return { name: value.name, message: value.message }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

export function hasActivityValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function formatActivityValue(value: unknown): string {
  if (!hasActivityValue(value)) return ''
  if (typeof value === 'string') return value
  try {
    const formatted = JSON.stringify(value, jsonReplacer(), 2)
    return formatted ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unprintable value]'
    }
  }
}

export function activityPreview(value: unknown, limit = DEFAULT_PREVIEW_LENGTH): string {
  const text = formatActivityValue(value).replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

export function formatActivityDuration(durationMs?: number | null): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

export function ActivityDisclosure({
  title,
  status,
  preview,
  meta,
  failed = false,
  emptyLabel,
  children,
}: {
  title: string
  status?: string
  preview?: string
  meta?: string
  failed?: boolean
  emptyLabel?: string
  children?: ReactNode
}) {
  const summary = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className={cn(typeStyle({ role: 'label', tone: failed ? 'danger' : 'secondary' }), 'shrink-0')}>{title}</span>
      {preview && <span className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'min-w-0 flex-1 truncate')} title={preview}>{preview}</span>}
      {status && <span className={cn(typeStyle({ role: 'status', tone: failed ? 'danger' : 'tertiary' }), 'ml-auto shrink-0')}>{status}</span>}
      {meta && <span className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'shrink-0 tabular-nums')}>{meta}</span>}
    </span>
  )

  if (!children) {
    return (
      <div className="flex min-w-0 items-center gap-2 py-1" data-activity-empty="true">
        {summary}
        {emptyLabel && <span className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'shrink-0')}>{emptyLabel}</span>}
      </div>
    )
  }

  return (
    <details className="group min-w-0" data-activity-disclosure="true">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1 rounded px-1 py-1 outline-none hover:bg-app-surface-2/55 focus-visible:bg-app-surface-2/70 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-app-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        {summary}
      </summary>
      <div className="ml-5 mt-1.5 min-w-0 space-y-2 pb-1">{children}</div>
    </details>
  )
}

export function ActivityPayload({ label, value, danger = false }: { label: string; value: unknown; danger?: boolean }) {
  if (!hasActivityValue(value)) return null
  return (
    <section className="min-w-0" aria-label={label}>
      <div className={typeStyle({ role: 'micro', tone: danger ? 'danger' : 'tertiary' })}>{label}</div>
      <pre className={cn(
        typeStyle({ role: 'code', tone: danger ? 'danger' : 'secondary' }),
        'mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-app-surface-2/45 px-2 py-1.5',
      )}>{formatActivityValue(value)}</pre>
    </section>
  )
}
