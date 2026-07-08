import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { cva, type VariantProps } from 'class-variance-authority'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const iconButton = cva(
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-app-text-muted transition-colors hover:bg-app-surface-2 hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:pointer-events-none disabled:opacity-40',
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
