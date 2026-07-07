import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface CommitState {
  status: 'idle' | 'committing' | 'success' | 'error'
  message: string | null
}

interface CommitDialogProps {
  title: string
  summary: string
  commitState: CommitState
  onClose: () => void
  onTitleChange: (title: string) => void
  onSummaryChange: (summary: string) => void
  onCommit: () => void
}

const inputClassName =
  'mt-1 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm normal-case tracking-normal text-app-text outline-none focus:border-app-text-muted'
const textareaClassName =
  'mt-1 h-24 w-full resize-none rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm normal-case tracking-normal text-app-text outline-none focus:border-app-text-muted'
const secondaryButtonClassName =
  'rounded-lg bg-app-surface-2 px-3 py-1.5 text-xs text-app-text-muted hover:text-app-text'
const primaryButtonClassName =
  'rounded-lg bg-app-surface-2 px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-border disabled:cursor-not-allowed disabled:opacity-40'

export function CommitDialog({
  title,
  summary,
  commitState,
  onClose,
  onTitleChange,
  onSummaryChange,
  onCommit,
}: CommitDialogProps) {
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-app-border bg-app-surface p-4 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-app-text">Commit changes</div>
            <div className="mt-1 text-[11px] text-app-text-muted">
              Stages all current changes and commits them.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Title
          <input
            autoFocus
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onCommit()
            }}
            className={inputClassName}
            placeholder="fix(git): commit from changes panel"
          />
        </label>
        <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Summary
          <textarea
            value={summary}
            onChange={(event) => onSummaryChange(event.target.value)}
            className={textareaClassName}
            placeholder="Optional body explaining what changed."
          />
        </label>
        {commitState.message && (
          <div className={`mt-3 text-xs ${commitState.status === 'error' ? 'text-app-danger' : 'text-app-text-muted'}`}>
            {commitState.message}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClassName}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={!title.trim() || commitState.status === 'committing'}
            className={primaryButtonClassName}
          >
            {commitState.status === 'committing' ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
