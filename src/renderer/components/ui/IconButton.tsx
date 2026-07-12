import { forwardRef, type ButtonHTMLAttributes } from 'react'
import type * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn, iconButton, type IconButtonVariants } from '../../lib/ui'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'>,
  IconButtonVariants {
  label: string
  tooltipSide?: TooltipPrimitive.TooltipContentProps['side']
  tooltipAlign?: TooltipPrimitive.TooltipContentProps['align']
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  tooltipSide,
  tooltipAlign,
  tone,
  className,
  disabled,
  type = 'button',
  ...buttonProps
}, ref) {
  return (
    <Tooltip
      content={label}
      side={tooltipSide}
      align={tooltipAlign}
      disabled={disabled}
      label={label}
    >
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        disabled={disabled}
        aria-label={disabled ? undefined : label}
        aria-hidden={disabled || undefined}
        tabIndex={disabled ? -1 : buttonProps.tabIndex}
        className={cn(iconButton({ tone }), className)}
      />
    </Tooltip>
  )
})
