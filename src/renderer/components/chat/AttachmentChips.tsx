import { FileText, X } from 'lucide-react'
import { attachmentPreviewFromPath } from './composer-attachments'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface AttachmentChipsProps {
  attachments: string[]
  onRemove: (filePath: string) => void
}

const ATTACHMENT_CHIP_CLASS = cn(
  typeStyle({ role: 'metadata' }),
  'inline-flex max-w-full items-center gap-1.5 rounded-lg bg-app-surface-2 px-1.5 py-1',
  'ring-1 ring-app-border/55 hover:bg-app-border/70',
)

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
                className="h-8 w-10 rounded-md object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-app-surface">
                <FileText className="h-3.5 w-3.5 text-app-text-secondary" />
              </span>
            )}
            <span className="max-w-44 truncate">{label}</span>
            <X className="h-3 w-3 shrink-0 text-app-text-secondary" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
