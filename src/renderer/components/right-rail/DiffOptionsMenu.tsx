import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

interface DiffOptionsMenuProps {
  position: { top: number; left: number }
  wrapContent: boolean
  onToggleWrapContent: () => void
}

export function DiffOptionsMenu({
  position,
  wrapContent,
  onToggleWrapContent,
}: DiffOptionsMenuProps) {
  return createPortal(
    <div
      data-diff-menu="true"
      className="fixed z-[1400] w-44 rounded-lg border border-app-border bg-app-surface p-1 text-xs shadow-2xl shadow-black/50"
      style={{ top: position.top, left: position.left }}
    >
      <button
        type="button"
        onClick={onToggleWrapContent}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-app-surface-2"
      >
        <span>Wrap diff content</span>
        {wrapContent && <Check className="h-3.5 w-3.5 text-app-accent" />}
      </button>
    </div>,
    document.body,
  )
}
