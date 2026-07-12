import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Laptop, MessageSquarePlus, TreePine } from 'lucide-react'
import { cn, iconButton, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export function NewSessionMenu({ onLocal, onWorktree, label = 'New session', className }: {
  onLocal: () => void
  onWorktree: () => void
  label?: string
  className?: string
}) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className={cn(iconButton(), className)} title={label} aria-label={label}><MessageSquarePlus className="h-3.5 w-3.5" /></button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={5} collisionPadding={8} className={cn(menuSurface, 'z-[1400] w-56')}>
        <DropdownMenu.Item className={itemClass} onSelect={onLocal}><Laptop className="h-4 w-4 text-app-text-muted" /><span><span className="block">New Local session</span><span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>Use the pinned checkout</span></span></DropdownMenu.Item>
        <DropdownMenu.Item className={itemClass} onSelect={onWorktree}><TreePine className="h-4 w-4 text-app-text-muted" /><span><span className="block">New Worktree session</span><span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>Create an isolated checkout</span></span></DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}

const itemClass = cn(typeStyle({ role: 'control' }), 'flex min-h-11 select-none items-center gap-2.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-app-surface-2')
