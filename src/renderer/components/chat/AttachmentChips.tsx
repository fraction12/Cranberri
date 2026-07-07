interface AttachmentChipsProps {
  attachments: string[]
  onRemove: (filePath: string) => void
}

const ATTACHMENT_CHIP_CLASS = [
  'rounded-full bg-[var(--app-surface-2)] px-2 py-0.5 text-[11px] text-[var(--app-text)]',
  'hover:bg-[var(--app-border)]',
].join(' ')

export function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1">
      {attachments.map((filePath) => (
        <button
          key={filePath}
          type="button"
          onClick={() => onRemove(filePath)}
          className={ATTACHMENT_CHIP_CLASS}
          title="Click to remove"
        >
          {filePath.split('/').pop() || filePath} ×
        </button>
      ))}
    </div>
  )
}
