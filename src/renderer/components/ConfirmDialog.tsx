import type { ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  busyLabel?: string
  danger?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  busyLabel,
  danger = false,
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/45 px-4 pt-[18vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[420px] rounded-lg border border-app-border bg-app-surface p-4 shadow-2xl"
      >
        <div className="text-sm font-semibold text-app-text">{title}</div>
        <div className="mt-2 text-xs leading-5 text-app-text-muted">{description}</div>
        {error && <div className="mt-3 text-xs text-app-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="h-8 rounded px-3 text-xs font-medium text-app-text-muted hover:bg-app-surface-2 hover:text-app-text disabled:opacity-50"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            className={`h-8 rounded px-3 text-xs font-semibold disabled:opacity-50 ${
              danger
                ? 'bg-app-danger text-white hover:bg-app-danger/90'
                : 'bg-app-accent text-app-bg hover:bg-app-accent/90'
            }`}
            onClick={onConfirm}
          >
            {busy ? busyLabel ?? confirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
