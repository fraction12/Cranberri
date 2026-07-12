import { Image, X } from 'lucide-react'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import { visualInputPreview } from './composer-attachments'
import type { ContextInputAttachment } from '@/shared/composer-drafts'

export function ContextInputChips({
  attachments,
  onRemove,
}: {
  attachments: ContextInputAttachment[]
  onRemove: (attachmentId: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1" data-composer-attachments="context">
      {attachments.map((attachment) => {
        const preview = visualInputPreview(attachment.input)
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => onRemove(attachment.id)}
            className={cn(
              typeStyle({ role: 'metadata' }),
              'inline-flex max-w-full items-center gap-1.5 rounded-lg bg-app-surface-2 px-1.5 py-1 ring-1 ring-app-border/55 hover:bg-app-border/70',
            )}
            title={`Remove ${attachment.label}`}
            aria-label={`Remove context attachment ${attachment.label}`}
          >
            {preview ? (
              <img src={preview.src} alt="" className="h-8 w-10 rounded-md object-cover" loading="lazy" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-app-surface">
                <Image className="h-3.5 w-3.5 text-app-text-secondary" />
              </span>
            )}
            <span className="max-w-44 truncate">{attachment.label}</span>
            <X className="h-3 w-3 shrink-0 text-app-text-secondary" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
