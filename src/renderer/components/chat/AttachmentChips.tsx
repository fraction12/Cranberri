import { FileText, X } from 'lucide-react'
import { attachmentPreviewFromPath } from './composer-attachments'

interface AttachmentChipsProps {
  attachments: string[]
  onRemove: (filePath: string) => void
}

const ATTACHMENT_CHIP_CLASS = [
  'inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--app-border)]',
  'bg-[var(--app-surface-2)] px-1.5 py-1 text-[11px] text-[var(--app-text)]',
  'hover:bg-[var(--app-border)]',
].join(' ')

export function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1" data-composer-attachments="files">
      {attachments.map((filePath) => {
        const preview = attachmentPreviewFromPath(filePath)
        const label = preview?.label ?? (filePath.split('/').pop() || filePath)
        return (
          <button
            key={filePath}
            type="button"
            onClick={() => onRemove(filePath)}
            className={ATTACHMENT_CHIP_CLASS}
            title={`Remove ${label}`}
            aria-label={`Remove attached file ${label}`}
          >
            {preview ? (
              <img
                src={preview.src}
                alt=""
                className="h-8 w-10 rounded border border-[var(--app-border)] object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded border border-[var(--app-border)] bg-[var(--app-surface)]">
                <FileText className="h-3.5 w-3.5 text-[var(--app-text-muted)]" />
              </span>
            )}
            <span className="max-w-44 truncate">{label}</span>
            <X className="h-3 w-3 shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
