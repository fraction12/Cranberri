import { Gauge, X } from 'lucide-react'

export function PlanModePill({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="group flex h-7 items-center gap-1.5 rounded-md bg-app-info/10 px-2 text-xs text-app-text hover:bg-app-info/15"
      title="Turn off plan mode"
    >
      <Gauge className="h-3.5 w-3.5" />
      <span>Plan</span>
      <X className="h-3 w-3 text-app-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
