import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, FolderOpen, Gauge, Goal, Loader2, Package, Plus, RotateCcw } from 'lucide-react'
import { cn, iconButton, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexPluginInfo } from '@/shared/codex'

const ITEM_CLASS = [
  'flex min-h-10 w-full select-none items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none',
  'data-[highlighted]:bg-app-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
].join(' ')

export function AddMenu({
  onAttachFiles,
  onGoal,
  onPlanMode,
  onPlugin,
}: {
  onAttachFiles: () => void
  onGoal: () => void
  onPlanMode: () => void
  onPlugin: (plugin: CodexPluginInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const pluginsQuery = useQuery({
    queryKey: ['codex', 'plugins'],
    queryFn: async () => (await window.cranberri.codex.plugins()).plugins,
    enabled: open,
    staleTime: 30_000,
  })
  const plugins = pluginsQuery.data ?? []

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={iconButton()} aria-label="Add context" title="Add context">
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-add-menu="true"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={cn(
            menuSurface,
            typeStyle({ role: 'body' }),
            'z-[1200] max-h-[min(440px,calc(100vh-24px))] w-[min(380px,calc(100vw-24px))] overflow-y-auto outline-none',
          )}
        >
          <DropdownMenu.Label className={cn(typeStyle({ role: 'label', tone: 'secondary' }), 'px-2 pb-1 pt-0.5')}>Add to chat</DropdownMenu.Label>
          <MenuItem icon={FolderOpen} label="Files and folders" description="Attach local context" onSelect={onAttachFiles} />
          <MenuItem icon={Goal} label="Goal" description="Keep Codex working toward an outcome" onSelect={onGoal} />
          <MenuItem icon={Gauge} label="Plan mode" description="Inspect and plan before editing" onSelect={onPlanMode} />

          <DropdownMenu.Label className={cn(typeStyle({ role: 'label', tone: 'secondary' }), 'mt-2 px-2 pb-1 pt-1')}>Plugins</DropdownMenu.Label>
          {pluginsQuery.isLoading ? (
            <div className={cn(typeStyle({ role: 'status', tone: 'secondary' }), 'flex items-center gap-2 px-2 py-2')}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading plugins
            </div>
          ) : pluginsQuery.isError ? (
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={(event) => { event.preventDefault(); void pluginsQuery.refetch() }}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-app-status-warning" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={cn(typeStyle({ role: 'control', tone: 'warning' }), 'block')}>Plugins unavailable</span>
                <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-0.5 flex items-center gap-1.5')}>
                  <RotateCcw className="h-3 w-3" aria-hidden="true" /> Retry
                </span>
              </span>
            </DropdownMenu.Item>
          ) : plugins.length === 0 ? (
            <div className={cn(typeStyle({ role: 'body', tone: 'secondary' }), 'px-2 py-2')}>No enabled plugins</div>
          ) : plugins.map((plugin) => (
            <DropdownMenu.Item
              key={plugin.id}
              onSelect={() => onPlugin(plugin)}
              className={ITEM_CLASS}
              title={plugin.toolCount ? `${plugin.toolCount} live connector tools available` : plugin.id}
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
              <span className="min-w-0 flex-1">
                <span className={cn(typeStyle({ role: 'control' }), 'flex items-center gap-2')}>
                  <span className="truncate">{plugin.displayName}</span>
                  {plugin.toolCount > 0 && (
                    <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'shrink-0')}>
                      {plugin.toolCount} tools
                    </span>
                  )}
                </span>
                {(plugin.description || plugin.prompt) && (
                  <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-0.5 block truncate')}>
                    {plugin.description || plugin.prompt}
                  </span>
                )}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuItem({
  icon: Icon,
  label,
  description,
  onSelect,
}: {
  icon: React.ElementType
  label: string
  description: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className={ITEM_CLASS}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
      <span className="min-w-0 flex-1">
        <span className={cn(typeStyle({ role: 'control' }), 'block')}>{label}</span>
        <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-0.5 block')}>{description}</span>
      </span>
    </DropdownMenu.Item>
  )
}
