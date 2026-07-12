import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Archive, Ellipsis, ExternalLink, FolderOpen, Laptop, RefreshCw, RotateCcw, TreePine } from 'lucide-react'
import type { Task } from '@/shared/tasks'
import { cn, iconButton, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

interface TaskHeaderProps {
  task: Task
  branch?: string | null
  onOpen?: () => void
  onOpenTerminal?: () => void
  onHandoff?: () => void | Promise<void>
  onRetrySetup?: () => void | Promise<void>
  onArchive?: () => void | Promise<void>
  onUnarchive?: () => void | Promise<void>
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '')
}

export function taskHeaderDetail(task: Task, branch?: string | null): string {
  if (branch && branch !== 'HEAD') return shortRef(branch)
  const base = task.baseRef ? shortRef(task.baseRef) : null
  if (task.location === 'worktree') return base ? `from ${base}` : 'detached'
  return base ?? 'detached'
}

export function TaskHeader({ task, branch, onOpen, onOpenTerminal, onHandoff, onRetrySetup, onArchive, onUnarchive }: TaskHeaderProps) {
  const location = task.location === 'local' ? 'Local' : 'Worktree'
  const detail = taskHeaderDetail(task, branch)
  const Icon = task.location === 'local' ? Laptop : TreePine
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 px-3">
      <Icon className="h-3.5 w-3.5 text-app-text-muted" />
      <span className={cn('min-w-0 flex-1 truncate', typeStyle({ role: 'control', tone: 'secondary' }))}>{location} · {detail}</span>
      {onOpen && <button type="button" className={iconButton()} aria-label="Open task folder" title="Open task folder" onClick={onOpen}><FolderOpen className="h-3.5 w-3.5" /></button>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button type="button" className={iconButton()} aria-label="Task actions" title="Task actions"><Ellipsis className="h-3.5 w-3.5" /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={5} className={cn(menuSurface, 'z-[1300] w-48')}>
            {onOpenTerminal && <DropdownMenu.Item className={itemClass} onSelect={onOpenTerminal}><ExternalLink className="h-3.5 w-3.5" />Open terminal</DropdownMenu.Item>}
            {onHandoff && task.role === 'root' && task.state !== 'archived' && <DropdownMenu.Item className={itemClass} onSelect={() => { void onHandoff() }}><RotateCcw className="h-3.5 w-3.5" />{task.location === 'local' ? task.worktreeId ? 'Return to worktree' : 'Continue in worktree' : 'Test in Local'}</DropdownMenu.Item>}
            {onRetrySetup && task.state === 'failed' && <DropdownMenu.Item className={itemClass} onSelect={() => { void onRetrySetup() }}><RefreshCw className="h-3.5 w-3.5" />Retry setup</DropdownMenu.Item>}
            {task.state === 'archived'
              ? onUnarchive && <DropdownMenu.Item className={itemClass} onSelect={() => { void onUnarchive() }}><RotateCcw className="h-3.5 w-3.5" />Restore session</DropdownMenu.Item>
              : onArchive && <DropdownMenu.Item className={itemClass} onSelect={() => { void onArchive() }}><Archive className="h-3.5 w-3.5" />Archive session</DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  )
}

const itemClass = cn(typeStyle({ role: 'control' }), 'flex min-h-8 items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2')
