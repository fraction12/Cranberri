import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, PackageOpen } from 'lucide-react'
import { cn, dropdownChevronStyle, dropdownTriggerStyle, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export interface EnvironmentOption { id: string; name: string; trusted: boolean }

export function selectedEnvironment(value: string | null, options: readonly EnvironmentOption[]): EnvironmentOption | null {
  return options.find((option) => option.trusted && option.id === value) ?? null
}

export function EnvironmentSelector({ value, options, side = 'top', onChange }: { value: string | null; options: readonly EnvironmentOption[]; side?: 'top' | 'bottom'; onChange: (id: string | null) => void }) {
  const usable = options.filter((option) => option.trusted)
  const selected = selectedEnvironment(value, usable)
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" aria-label={`Environment: ${selected?.name ?? 'No environment'}`} title="Environment" data-dropdown-trigger="compact" className={dropdownTriggerStyle()}><PackageOpen className="h-3.5 w-3.5" /><span className="max-w-36 truncate">{selected?.name ?? 'No environment'}</span><ChevronDown aria-hidden="true" data-dropdown-chevron="true" className={dropdownChevronStyle()} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content data-dropdown-menu="environment" side={side} align="start" sideOffset={7} collisionPadding={10} className={cn(menuSurface, 'z-[1300] w-60 max-h-[min(320px,calc(100vh-32px))] overflow-y-auto overscroll-contain')} onWheel={(event) => event.stopPropagation()}>
    <DropdownMenu.RadioGroup value={value ?? '__none__'} onValueChange={(id) => onChange(id === '__none__' ? null : id)}>
      <EnvironmentItem id="__none__" name="No environment" />
      {usable.map((option) => <EnvironmentItem key={option.id} id={option.id} name={option.name} />)}
    </DropdownMenu.RadioGroup>
    {usable.length === 0 && <p className={cn('px-2 py-1.5', typeStyle({ role: 'metadata', tone: 'secondary' }))}>Create and trust a profile in Settings.</p>}
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}
function EnvironmentItem({ id, name }: { id: string; name: string }) { return <DropdownMenu.RadioItem value={id} className={itemClass}><span className="min-w-0 flex-1 truncate">{name}</span><DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem> }
const itemClass = cn(typeStyle({ role: 'control' }), 'flex min-h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2')
