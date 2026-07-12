import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { buttonStyle, cn, dialogSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'

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
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2400] bg-[var(--app-overlay)]" />
        <Dialog.Content
          className={cn(dialogSurface, 'fixed left-1/2 top-[28%] z-[2401] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 p-5')}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
        >
          <ConfirmDialogBody
            title={<Dialog.Title className={typeStyle({ role: 'overlayTitle', tone: 'primary' })}>{title}</Dialog.Title>}
            description={(
              <Dialog.Description asChild>
                <div className={cn('mt-2 break-words', typeStyle({ role: 'body', tone: 'secondary' }))}>{description}</div>
              </Dialog.Description>
            )}
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            busy={busy}
            busyLabel={busyLabel}
            danger={danger}
            error={error}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface ConfirmDialogBodyProps extends Omit<ConfirmDialogProps, 'title' | 'description'> {
  title: ReactNode
  description: ReactNode
}

function ConfirmDialogBody({
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
}: ConfirmDialogBodyProps) {
  return (
    <>
      {title}
      {description}
      {error && <div className={cn('mt-3 break-words rounded-md bg-app-danger/8 px-3 py-2', typeStyle({ role: 'status', tone: 'danger' }))} role="alert">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} className={buttonStyle({ tone: 'ghost', size: 'small' })} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" disabled={busy} className={buttonStyle({ tone: danger ? 'danger' : 'primary', size: 'small' })} onClick={onConfirm}>
          {busy ? busyLabel ?? confirmLabel : confirmLabel}
        </button>
      </div>
    </>
  )
}

export function ConfirmDialogContent(props: ConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      className={cn(dialogSurface, 'w-[min(420px,calc(100vw-32px))] p-5')}
    >
      <ConfirmDialogBody
        {...props}
        title={<h2 className={typeStyle({ role: 'overlayTitle', tone: 'primary' })}>{props.title}</h2>}
        description={<div className={cn('mt-2 break-words', typeStyle({ role: 'body', tone: 'secondary' }))}>{props.description}</div>}
      />
    </div>
  )
}
