import { Goal, X } from 'lucide-react'

interface GoalModePillProps {
  onRemove: () => void
}

const GOAL_BUTTON_CLASS = [
  'group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-[var(--app-text)]',
  'hover:bg-[var(--app-surface-2)] hover:text-[var(--app-text)]',
].join(' ')

export function GoalModePill({ onRemove }: GoalModePillProps) {
  return (
    <>
      <div className="h-4 w-px bg-[var(--app-border)]" />
      <button
        type="button"
        onClick={onRemove}
        className={GOAL_BUTTON_CLASS}
        title="Remove goal"
      >
        <Goal className="h-3.5 w-3.5" />
        <span>Goal</span>
        <X className="hidden h-3 w-3 text-[var(--app-text-muted)] group-hover:block" />
      </button>
    </>
  )
}
