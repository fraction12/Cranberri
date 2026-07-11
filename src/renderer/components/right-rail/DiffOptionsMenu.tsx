import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Copy, ExternalLink, FileText, FolderOpen, MoreHorizontal, WrapText } from 'lucide-react'
import { cn, iconButton, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface DiffOptionsMenuProps {
  wrapContent: boolean
  canReadFile: boolean
  canOpenFile: boolean
  onToggleWrapContent: () => void
  onCopyPath: () => void
  onCopyAbsolutePath: () => void
  onCopyContent: () => void
  onOpenFile: () => void
  onRevealFile: () => void
}

const ITEM_CLASS = cn(
  'flex min-h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  typeStyle({ role: 'control' }),
)

export function DiffOptionsMenu({
  wrapContent,
  canReadFile,
  canOpenFile,
  onToggleWrapContent,
  onCopyPath,
  onCopyAbsolutePath,
  onCopyContent,
  onOpenFile,
  onRevealFile,
}: DiffOptionsMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={iconButton()} title="File options" aria-label="File options">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={cn(menuSurface, 'z-[1400] w-52 outline-none')}
        >
          <DropdownMenu.CheckboxItem checked={wrapContent} onCheckedChange={onToggleWrapContent} className={ITEM_CLASS}>
            <WrapText className="h-3.5 w-3.5 text-app-text-muted" />
            <span className="flex-1">Wrap content</span>
            <DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5 text-app-accent" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Item onSelect={onCopyPath} className={ITEM_CLASS} aria-label="Copy selected file path">
            <Copy className="h-3.5 w-3.5 text-app-text-muted" /> Copy relative path
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!canOpenFile} onSelect={onCopyAbsolutePath} className={ITEM_CLASS} aria-label="Copy selected file absolute path">
            <Copy className="h-3.5 w-3.5 text-app-text-muted" /> Copy absolute path
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!canReadFile} onSelect={onCopyContent} className={ITEM_CLASS} aria-label="Copy selected file content">
            <FileText className="h-3.5 w-3.5 text-app-text-muted" /> Copy file contents
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!canOpenFile} onSelect={onOpenFile} className={ITEM_CLASS} aria-label="Open selected file">
            <ExternalLink className="h-3.5 w-3.5 text-app-text-muted" /> Open file
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={!canOpenFile} onSelect={onRevealFile} className={ITEM_CLASS} aria-label="Reveal selected file in Finder">
            <FolderOpen className="h-3.5 w-3.5 text-app-text-muted" /> Reveal in Finder
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
