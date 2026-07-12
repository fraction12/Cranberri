import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { cva, type VariantProps } from 'class-variance-authority'
import { typeStyle } from './typography'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-2'

export const iconButton = cva(
  `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-app-text-muted transition-colors duration-fast ease-standard hover:bg-app-surface-2 hover:text-app-text ${focusRing} disabled:pointer-events-none disabled:opacity-40`,
  {
    variants: {
      tone: {
        neutral: '',
        danger: 'hover:text-app-danger',
        active: 'bg-app-surface-2 text-app-text',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
)

export type IconButtonVariants = VariantProps<typeof iconButton>

export const buttonStyle = cva(
  cn(
    `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md transition-colors duration-fast ease-standard ${focusRing} disabled:pointer-events-none disabled:opacity-40`,
    typeStyle({ role: 'control', tone: null }),
  ),
  {
    variants: {
      tone: {
        primary: 'bg-app-accent text-app-accent-contrast hover:bg-app-accent-hover',
        secondary: 'bg-app-surface-2 text-app-text hover:bg-app-border/80',
        ghost: 'text-app-text-muted hover:bg-app-surface-2 hover:text-app-text',
        danger: 'bg-app-danger-fill text-app-on-danger hover:bg-app-danger-fill-hover',
      },
      size: {
        compact: 'h-7 px-2',
        small: 'h-8 px-2.5',
        medium: 'h-9 px-3',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      tone: 'secondary',
      size: 'small',
    },
  },
)

export type ButtonStyleVariants = VariantProps<typeof buttonStyle>

export const fieldStyle = cn(
  'h-9 min-w-0 rounded-md border border-app-border bg-app-bg px-2.5',
  typeStyle({ role: 'control' }),
  'placeholder:text-app-text-subtle hover:border-app-border-strong',
  `transition-colors duration-fast ease-standard ${focusRing}`,
  'disabled:opacity-45',
)

export const compactFieldStyle = cn(fieldStyle, 'h-8 px-2')

export const selectControlStyle = cva(
  cn(fieldStyle, 'peer w-full appearance-none'),
  {
    variants: {
      density: {
        compact: 'h-8 pl-2.5 pr-8',
        standard: 'h-9 pl-3.5 pr-10',
      },
    },
    defaultVariants: {
      density: 'standard',
    },
  },
)

export const dropdownTriggerStyle = cva(
  `inline-flex min-w-0 items-center rounded-md transition-colors duration-fast ease-standard hover:bg-app-surface-2 data-[state=open]:bg-app-surface-2 ${focusRing}`,
  {
    variants: {
      density: {
        compact: 'h-7 gap-1.5 pl-2 pr-2.5',
        standard: 'h-9 gap-2 pl-3.5 pr-3',
      },
      tone: {
        primary: typeStyle({ role: 'control' }),
        secondary: cn(typeStyle({ role: 'control', tone: 'secondary' }), 'hover:text-app-text data-[state=open]:text-app-text'),
      },
    },
    defaultVariants: {
      density: 'compact',
      tone: 'primary',
    },
  },
)

export const dropdownChevronStyle = cva(
  'shrink-0 text-app-text-muted',
  {
    variants: {
      density: {
        compact: 'h-3 w-3',
        standard: 'h-3.5 w-3.5',
      },
      placement: {
        flow: 'ml-auto',
        overlay: 'pointer-events-none absolute top-1/2 -translate-y-1/2',
      },
    },
    compoundVariants: [
      { density: 'compact', placement: 'overlay', className: 'right-2.5' },
      { density: 'standard', placement: 'overlay', className: 'right-3' },
    ],
    defaultVariants: {
      density: 'compact',
      placement: 'flow',
    },
  },
)

export const menuSurface = 'rounded-lg bg-app-elevated p-1.5 shadow-2xl ring-1 ring-app-border/80'
export const dialogSurface = 'rounded-lg bg-app-elevated shadow-2xl ring-1 ring-app-border/80'
export const segmentedControl = 'grid gap-1 rounded-lg bg-app-bg p-1 ring-1 ring-app-border/55'
export const segmentedItem = cn(
  'rounded-md transition-colors duration-fast ease-standard hover:bg-app-surface-2/35 hover:text-app-text',
  typeStyle({ role: 'control', tone: 'secondary' }),
  focusRing,
)

export const segmentedItemActive = 'bg-app-surface-2 text-app-text shadow-sm ring-1 ring-app-border-strong/65 hover:bg-app-surface-2'
