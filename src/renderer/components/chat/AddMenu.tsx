import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FolderOpen, Gauge, Goal, Package, Plus } from 'lucide-react'
import { cn, iconButton, menuSurface } from '../../lib/ui'
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
  const [plugins, setPlugins] = useState<CodexPluginInfo[]>([])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) return
    window.cranberri.codex.plugins()
      .then((result) => setPlugins(result.plugins))
      .catch((error) => console.error('Failed to load Codex plugins:', error))
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
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={cn(menuSurface, 'z-[1200] max-h-[min(440px,calc(100vh-24px))] w-[min(380px,calc(100vw-24px))] overflow-y-auto text-xs text-app-text outline-none')}
        >
          <DropdownMenu.Label className="px-2 pb-1 pt-0.5 text-caption font-medium text-app-text-muted">Add to chat</DropdownMenu.Label>
          <MenuItem icon={FolderOpen} label="Files and folders" description="Attach local context" onSelect={onAttachFiles} />
          <MenuItem icon={Goal} label="Goal" description="Keep Codex working toward an outcome" onSelect={onGoal} />
          <MenuItem icon={Gauge} label="Plan mode" description="Inspect and plan before editing" onSelect={onPlanMode} />

          <DropdownMenu.Label className="mt-2 px-2 pb-1 pt-1 text-caption font-medium text-app-text-muted">Plugins</DropdownMenu.Label>
          {plugins.length === 0 ? (
            <div className="px-2 py-2 text-xs text-app-text-muted">No enabled plugins</div>
          ) : plugins.map((plugin) => (
            <DropdownMenu.Item
              key={plugin.id}
              onSelect={() => onPlugin(plugin)}
              className={ITEM_CLASS}
              title={plugin.toolCount ? `${plugin.toolCount} live connector tools available` : plugin.id}
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm text-app-text">
                  <span className="truncate">{plugin.displayName}</span>
                  {plugin.toolCount > 0 && <span className="shrink-0 text-caption text-app-text-muted">{plugin.toolCount} tools</span>}
                </span>
                {(plugin.description || plugin.prompt) && (
                  <span className="mt-0.5 block truncate text-caption text-app-text-muted">{plugin.description || plugin.prompt}</span>
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
        <span className="block text-sm text-app-text">{label}</span>
        <span className="mt-0.5 block text-caption text-app-text-muted">{description}</span>
      </span>
    </DropdownMenu.Item>
  )
}
