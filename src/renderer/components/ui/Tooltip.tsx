import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { createContext, type ReactElement, type ReactNode, useContext } from 'react'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'

export const TOOLTIP_DELAY_DURATION = 350
export const TOOLTIP_SKIP_DELAY_DURATION = 100
const TooltipProviderContext = createContext(false)

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={TOOLTIP_DELAY_DURATION}
      skipDelayDuration={TOOLTIP_SKIP_DELAY_DURATION}
    >
      <TooltipProviderContext.Provider value>{children}</TooltipProviderContext.Provider>
    </TooltipPrimitive.Provider>
  )
}

interface TooltipProps {
  children: ReactElement
  content: ReactNode
  side?: TooltipPrimitive.TooltipContentProps['side']
  align?: TooltipPrimitive.TooltipContentProps['align']
  contentClassName?: string
  disabled?: boolean
  label?: string
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  contentClassName,
  disabled = false,
  label,
}: TooltipProps) {
  const hasProvider = useContext(TooltipProviderContext)
  const trigger = disabled ? (
    <span
      className="inline-flex"
      role="button"
      aria-disabled="true"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </span>
  ) : children

  if (!hasProvider) return trigger

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-cranberri-tooltip="true"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'pointer-events-none z-[2600] max-w-72 select-none rounded-md bg-app-elevated px-2 py-1 text-app-text shadow-xl ring-1 ring-app-border/80',
            typeStyle({ role: 'metadata' }),
            contentClassName,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
