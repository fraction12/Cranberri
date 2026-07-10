import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/ui'

export interface ToolGroupProps {
  label: string
  children: ReactNode
  className?: string
}

export function ToolGroup({ label, children, className }: ToolGroupProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('border-b border-app-border last:border-b-0', className)}>
      <h3 id={headingId} className="px-3 py-1.5 text-micro font-semibold uppercase text-app-text-muted">
        {label}
      </h3>
      <div className="divide-y divide-app-border border-t border-app-border">{children}</div>
    </section>
  )
}
