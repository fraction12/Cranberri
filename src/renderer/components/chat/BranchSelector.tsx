import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, GitBranch, Loader2 } from 'lucide-react'
import { cn, dropdownChevronStyle, dropdownTriggerStyle, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export interface BranchOption { ref: string; label: string; remote?: string }

export function BranchSelector({ value, options, loading = false, partialFallback = false, includeLocalEligible = false, includeLocalChanges = false, side = 'top', onChange, onIncludeLocalChanges, onRetry }: {
  value: string; options: readonly BranchOption[]; loading?: boolean; partialFallback?: boolean; includeLocalEligible?: boolean; includeLocalChanges?: boolean; side?: 'top' | 'bottom'; onChange: (ref: string) => void; onIncludeLocalChanges?: (include: boolean) => void; onRetry?: () => void
}) {
  const selected = options.find((option) => option.ref === value)
  const retryRef = useRef(onRetry)
  retryRef.current = onRetry
  useEffect(() => {
    if (!partialFallback) {
      toast.dismiss('branch-refresh-fallback')
      return
    }
    toast.warning('Some remotes could not be refreshed', {
      id: 'branch-refresh-fallback',
      description: 'Showing available branches.',
      action: retryRef.current ? { label: 'Retry', onClick: () => retryRef.current?.() } : undefined,
    })
  }, [partialFallback])
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" aria-label={`Base branch: ${selected?.label ?? value}`} title={selected?.label ?? value} data-dropdown-trigger="compact" className={dropdownTriggerStyle()}><GitBranch className="h-3.5 w-3.5" /><span className="max-w-32 truncate">{selected?.label ?? value}</span><ChevronDown aria-hidden="true" data-dropdown-chevron="true" className={dropdownChevronStyle()} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content data-dropdown-menu="branch" side={side} align="start" sideOffset={7} collisionPadding={10} className={cn(menuSurface, 'z-[1300] w-64 max-h-[min(340px,calc(100vh-32px))] overflow-y-auto overscroll-contain')} onWheel={(event) => event.stopPropagation()}>
    {loading && <div className={cn('flex h-9 items-center gap-2 px-2', typeStyle({ role: 'status', tone: 'secondary' }))}><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading branches</div>}
    {!loading && <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>{options.map((option) => <DropdownMenu.RadioItem key={option.ref} value={option.ref} className={itemClass}><span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>{option.remote && <span className={typeStyle({ role: 'metadata', tone: 'secondary' })}>{option.remote}</span>}<DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup>}
    {!loading && options.length === 0 && <div className={cn('px-2 py-2', typeStyle({ role: 'status', tone: 'secondary' }))}>No branches available</div>}
    {includeLocalEligible && <DropdownMenu.CheckboxItem checked={includeLocalChanges} className={cn(itemClass, 'cursor-pointer')} onCheckedChange={(checked) => onIncludeLocalChanges?.(checked === true)}><span className="w-3.5"><DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5" /></DropdownMenu.ItemIndicator></span><span>Include local changes</span></DropdownMenu.CheckboxItem>}
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}
const itemClass = cn(typeStyle({ role: 'control' }), 'flex min-h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-app-surface-2')
