import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/ui'

export interface ToolGroupProps {
  label: string
  children: ReactNode
  className?: string
  divided?: boolean
}

export function ToolGroup({ label, children, className, divided = true }: ToolGroupProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn(divided && 'border-b border-app-border last:border-b-0', className)}>
      <h3 id={headingId} className="px-3 py-1.5 text-micro font-semibold uppercase text-app-text-muted">
        {label}
      </h3>
      <div className={cn(divided ? 'divide-y divide-app-border border-t border-app-border' : 'space-y-1')}>{children}</div>
    </section>
  )
}
