import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { buttonStyle, cn, compactFieldStyle, dialogSurface } from '../lib/ui'
import { typeStyle } from '../lib/typography'

interface PromptDialogProps {
  title: string
  description: string
  label: string
  initialValue: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: (value: string) => void
}

export function PromptDialog({ title, description, label, initialValue, confirmLabel, busy = false, error, onCancel, onConfirm }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  useEffect(() => setValue(initialValue), [initialValue])
  const normalized = value.trim()

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[2400] bg-[var(--app-overlay)]" />
      <Dialog.Content
        className={cn(dialogSurface, 'fixed left-1/2 top-[28%] z-[2401] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 p-5')}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
      >
        <Dialog.Title className={typeStyle({ role: 'overlayTitle' })}>{title}</Dialog.Title>
        <Dialog.Description className={cn('mt-2', typeStyle({ role: 'body', tone: 'secondary' }))}>{description}</Dialog.Description>
        <label className={cn('mt-4 block', typeStyle({ role: 'label', tone: 'secondary' }))}>
          {label}
          <input autoFocus value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} className={cn(compactFieldStyle, 'mt-1.5 w-full')} />
        </label>
        {error && <div role="alert" className={cn('mt-3 rounded-md bg-app-danger/8 px-3 py-2', typeStyle({ role: 'status', tone: 'danger' }))}>{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} className={buttonStyle({ tone: 'ghost', size: 'small' })} onClick={onCancel}>Cancel</button>
          <button type="button" disabled={busy || !normalized} className={buttonStyle({ tone: 'primary', size: 'small' })} onClick={() => onConfirm(normalized)}>
            {busy ? 'Moving' : confirmLabel}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
