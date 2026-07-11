import { Goal, X } from 'lucide-react'

interface GoalModePillProps {
  onRemove: () => void
}

const GOAL_BUTTON_CLASS = 'group flex h-7 items-center gap-1.5 rounded-md bg-app-accent/10 px-2 text-xs text-app-text hover:bg-app-accent/15'

export function GoalModePill({ onRemove }: GoalModePillProps) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className={GOAL_BUTTON_CLASS}
      title="Remove goal"
    >
      <Goal className="h-3.5 w-3.5" />
      <span>Goal</span>
      <X className="h-3 w-3 text-app-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
