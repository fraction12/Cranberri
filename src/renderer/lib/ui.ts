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

export const menuSurface = 'rounded-lg bg-app-elevated p-1.5 shadow-2xl ring-1 ring-app-border/80'
export const dialogSurface = 'rounded-lg bg-app-elevated shadow-2xl ring-1 ring-app-border/80'
export const segmentedControl = 'grid gap-1 rounded-lg bg-app-bg p-1 ring-1 ring-app-border/55'
export const segmentedItem = cn(
  'rounded-md transition-colors duration-fast ease-standard hover:bg-app-surface-2/35 hover:text-app-text',
  typeStyle({ role: 'control', tone: 'secondary' }),
  focusRing,
)

export const segmentedItemActive = 'bg-app-surface-2 text-app-text shadow-sm ring-1 ring-app-border-strong/65 hover:bg-app-surface-2'
