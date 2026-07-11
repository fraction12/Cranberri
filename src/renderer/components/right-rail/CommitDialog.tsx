import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Sparkles, X } from 'lucide-react'
import { buttonStyle, cn, dialogSurface, fieldStyle, iconButton } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export interface CommitState {
  status: 'idle' | 'committing' | 'success' | 'error'
  message: string | null
}

export interface CommitDraftState {
  status: 'idle' | 'drafting' | 'error'
  message: string | null
}

interface CommitDialogProps {
  title: string
  summary: string
  commitState: CommitState
  draftState: CommitDraftState
  canDraft: boolean
  onClose: () => void
  onTitleChange: (title: string) => void
  onSummaryChange: (summary: string) => void
  onDraft: () => void
  onCommit: () => void
}

export function CommitDialog({
  title,
  summary,
  commitState,
  draftState,
  canDraft,
  onClose,
  onTitleChange,
  onSummaryChange,
  onDraft,
  onCommit,
}: CommitDialogProps) {
  const busy = commitState.status === 'committing'
  const draftDisabled = !canDraft || draftState.status === 'drafting' || busy

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1500] bg-[var(--app-overlay)]" />
        <Dialog.Content
          className={cn(dialogSurface, 'fixed left-1/2 top-1/2 z-[1501] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-5')}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className={typeStyle({ role: 'overlayTitle' })}>Commit changes</Dialog.Title>
              <Dialog.Description className={cn('mt-1', typeStyle({ role: 'body', tone: 'secondary' }))}>Stage and commit the current working tree.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" disabled={busy} className={iconButton()} title="Close" aria-label="Close commit dialog">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <label className={cn('mt-5 block', typeStyle({ role: 'label' }))}>
            Title
            <input
              autoFocus
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onCommit()
              }}
              className={cn(fieldStyle, 'mt-1.5 w-full')}
              placeholder="fix(git): describe the change"
            />
          </label>
          <label className={cn('mt-4 block', typeStyle({ role: 'label' }))}>
            Summary
            <textarea
              value={summary}
              onChange={(event) => onSummaryChange(event.target.value)}
              className={cn(fieldStyle, 'mt-1.5 h-24 w-full resize-none py-2')}
              placeholder="Optional context for the commit body"
            />
          </label>

          {(draftState.status === 'error' || commitState.status === 'error') && (
            <div className={cn('mt-3 rounded-md bg-app-status-danger/8 px-3 py-2 [overflow-wrap:anywhere]', typeStyle({ role: 'status', tone: 'danger' }))} role="alert">
              {draftState.message ?? commitState.message}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={onDraft} disabled={draftDisabled} className={buttonStyle({ tone: 'ghost', size: 'small' })} title="Draft from current changes">
              {draftState.status === 'drafting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {draftState.status === 'drafting' ? 'Drafting' : 'Draft with Codex'}
            </button>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" disabled={busy} className={buttonStyle({ tone: 'ghost', size: 'small' })}>Cancel</button>
              </Dialog.Close>
              <button type="button" onClick={onCommit} disabled={!title.trim() || busy} className={buttonStyle({ tone: 'primary', size: 'small' })}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? 'Committing' : 'Commit'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
