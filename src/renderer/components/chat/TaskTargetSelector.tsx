import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, GitBranch, Laptop, TreePine } from 'lucide-react'
import { cn, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export type TaskTarget = 'local' | 'worktree'

export function TaskTargetSelector({ value, onChange, localUnavailableReason }: {
  value: TaskTarget
  onChange: (value: TaskTarget) => void
  localUnavailableReason?: string
}) {
  const label = value === 'worktree' ? 'Worktree' : 'Local'
  const Icon = value === 'worktree' ? TreePine : Laptop
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`Task location: ${label}`} title="Task location" className={triggerClass}>
          <Icon className="h-3.5 w-3.5" /><span>{label}</span><ChevronDown className="h-3 w-3 text-app-text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={7} collisionPadding={10} className={cn(menuSurface, 'z-[1300] w-56 max-h-[min(300px,calc(100vh-32px))] overflow-y-auto overscroll-contain')} onWheel={(event) => event.stopPropagation()}>
          <TargetItem value="worktree" label="Worktree" description="Isolated checkout" icon={TreePine} selected={value === 'worktree'} onSelect={onChange} />
          <TargetItem value="local" label="Local" description={localUnavailableReason ?? 'Pinned checkout'} icon={Laptop} selected={value === 'local'} disabled={Boolean(localUnavailableReason)} onSelect={onChange} />
          {value === 'worktree' && <DropdownMenu.Item className={itemClass} onSelect={(event) => event.preventDefault()}><GitBranch className="h-3.5 w-3.5" /><span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>No environment is available from the location menu.</span></DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const triggerClass = cn(typeStyle({ role: 'control' }), 'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 hover:bg-app-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent')
const itemClass = cn(typeStyle({ role: 'control' }), 'flex min-h-9 select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-app-surface-2 data-[disabled]:opacity-45')

function TargetItem({ value, label, description, icon: Icon, selected, disabled, onSelect }: {
  value: TaskTarget; label: string; description: string; icon: React.ElementType; selected: boolean; disabled?: boolean; onSelect: (value: TaskTarget) => void
}) {
  return <DropdownMenu.Item disabled={disabled} className={itemClass} onSelect={() => onSelect(value)}><Icon className="h-3.5 w-3.5" /><span className="min-w-0 flex-1"><span className="block">{label}</span><span className={cn('block truncate', typeStyle({ role: 'metadata', tone: 'secondary' }))}>{description}</span></span>{selected && <Check className="h-3.5 w-3.5" />}</DropdownMenu.Item>
}
