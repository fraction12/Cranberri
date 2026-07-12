import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn, dropdownChevronStyle, selectControlStyle } from '../../lib/ui'

export interface SelectControlProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  className?: string
  density?: 'compact' | 'standard'
  selectClassName?: string
}

export const SelectControl = forwardRef<HTMLSelectElement, SelectControlProps>(function SelectControl({
  className,
  density = 'standard',
  selectClassName,
  children,
  ...props
}, ref) {
  return (
    <span className={cn('relative inline-grid min-w-0 max-w-full', className)} data-select-control={density}>
      <select ref={ref} className={cn(selectControlStyle({ density }), selectClassName)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        data-select-chevron="true"
        className={cn(dropdownChevronStyle({ density, placement: 'overlay' }), 'peer-disabled:opacity-45')}
      />
    </span>
  )
})
