import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export interface ToolGroupProps {
  label: string
  children: ReactNode
  className?: string
}

export function ToolGroup({ label, children, className }: ToolGroupProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('mb-2 px-1', className)}>
      <h3 id={headingId} className={cn('px-2 pb-1 pt-2', typeStyle({ role: 'label', tone: 'secondary' }))}>
        {label}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}
