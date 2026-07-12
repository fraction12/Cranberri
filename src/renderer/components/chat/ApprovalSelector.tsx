import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Hand, Settings2, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { cn, dropdownChevronStyle, dropdownTriggerStyle, menuSurface } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexApprovalMode } from '@/shared/codex'
import { CODEX_APPROVAL_MODES } from '@/shared/codex'

const OPTION_CLASS = [
  'relative flex min-h-11 w-full select-none items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none',
  'data-[highlighted]:bg-app-surface-2',
].join(' ')

export function ApprovalSelector({
  value,
  onChange,
}: {
  value: CodexApprovalMode
  onChange: (value: CodexApprovalMode) => void
}) {
  const selected = CODEX_APPROVAL_MODES.find((option) => option.value === value) ?? CODEX_APPROVAL_MODES[3]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-dropdown-trigger="compact"
          className={dropdownTriggerStyle({ tone: 'secondary' })}
          aria-label={`Approval policy: ${selected.label}`}
          title="Approval policy"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>{selected.value === 'custom' ? 'Custom' : selected.label}</span>
          <ChevronDown aria-hidden="true" data-dropdown-chevron="true" className={dropdownChevronStyle()} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-dropdown-menu="approval"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={cn(
            menuSurface,
            typeStyle({ role: 'body' }),
            'z-[1200] w-[min(390px,calc(100vw-24px))] outline-none',
          )}
        >
          <DropdownMenu.Label className={cn(typeStyle({ role: 'label', tone: 'secondary' }), 'px-2 pb-1 pt-0.5')}>Approval policy</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => onChange(nextValue as CodexApprovalMode)}>
            {CODEX_APPROVAL_MODES.map((option) => {
              const Icon = approvalIcon(option.value)
              return (
                <DropdownMenu.RadioItem key={option.value} value={option.value} className={OPTION_CLASS}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-app-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className={cn(typeStyle({ role: 'control' }), 'block')}>{option.label}</span>
                    <span className={cn(typeStyle({ role: 'metadata', tone: 'secondary' }), 'mt-0.5 block')}>{option.description}</span>
                  </span>
                  <DropdownMenu.ItemIndicator className="mt-0.5 shrink-0">
                    <Check className="h-3.5 w-3.5 text-app-accent" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function approvalIcon(value: CodexApprovalMode): React.ElementType {
  if (value === 'ask') return Hand
  if (value === 'approve') return ShieldQuestion
  if (value === 'full') return ShieldCheck
  if (value === 'custom') return Settings2
  return Settings2
}
