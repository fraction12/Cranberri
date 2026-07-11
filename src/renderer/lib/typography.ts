import { cva, type VariantProps } from 'class-variance-authority'
import { twMerge } from 'tailwind-merge'

export const CODE_LINE_HEIGHT = 1.5
export const TERMINAL_LINE_HEIGHT = 1.3

const typeStyleVariants = cva('', {
  variants: {
    role: {
      pageTitle: 'type-page-title font-sans font-semibold',
      overlayTitle: 'type-overlay-title font-sans font-semibold',
      panelTitle: 'type-panel-title font-sans font-semibold',
      proseHeading1: 'type-prose-heading-1 font-sans font-semibold',
      proseHeading2: 'type-prose-heading-2 font-sans font-semibold',
      proseHeading3: 'type-prose-heading-3 font-sans font-semibold',
      proseHeading4: 'type-prose-heading-4 font-sans font-semibold',
      proseHeading5: 'type-prose-heading-5 font-sans font-semibold',
      proseHeading6: 'type-prose-heading-6 font-sans font-semibold',
      body: 'type-body font-sans font-normal',
      prose: 'type-prose font-sans font-normal',
      control: 'type-control font-sans font-medium',
      label: 'type-label font-sans font-medium',
      metadata: 'type-metadata font-sans font-normal',
      micro: 'type-micro font-sans font-medium',
      status: 'type-status font-sans font-medium',
      code: 'type-code font-mono font-normal',
      terminal: 'type-terminal font-mono font-normal',
    },
    family: {
      ui: 'font-sans',
      mono: 'font-mono',
    },
    weight: {
      normal: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
    },
    tone: {
      primary: 'text-app-text',
      secondary: 'text-app-text-secondary',
      tertiary: 'text-app-text-tertiary',
      disabled: 'text-app-text-disabled',
      success: 'text-app-status-success',
      warning: 'text-app-status-warning',
      info: 'text-app-status-info',
      danger: 'text-app-status-danger',
      mention: 'text-app-mention',
      onAccent: 'text-app-accent-contrast',
      onDanger: 'text-app-on-danger',
    },
  },
  defaultVariants: {
    role: 'body',
    tone: 'primary',
  },
})

export type TypeStyleVariants = VariantProps<typeof typeStyleVariants>

export function typeStyle(options?: TypeStyleVariants): string {
  return twMerge(typeStyleVariants(options))
}
