import { Toaster, type ToasterProps } from 'sonner'
import { useAppearance } from '../state/appearance-context'
import { cn } from '../lib/ui'
import { typeStyle } from '../lib/typography'

export const APP_TOAST_OPTIONS = {
  unstyled: true,
  classNames: {
    toast: cn(
      'flex w-[var(--width)] items-start gap-2.5 rounded-lg bg-app-elevated px-3 py-2.5 shadow-xl ring-1 ring-app-border/80',
      typeStyle({ role: 'body', tone: 'primary' }),
    ),
    content: 'flex min-w-0 flex-1 flex-col gap-0.5',
    icon: 'mt-0.5 shrink-0',
    title: typeStyle({ role: 'control', tone: 'primary' }),
    description: typeStyle({ role: 'metadata', tone: 'secondary' }),
    actionButton: cn(
      'ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-app-accent px-2.5 outline-none transition-colors hover:bg-app-accent-hover focus-visible:ring-2 focus-visible:ring-app-accent',
      typeStyle({ role: 'control', tone: 'onAccent' }),
    ),
    cancelButton: cn(
      'ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-app-surface-2 px-2.5 outline-none transition-colors hover:bg-app-border focus-visible:ring-2 focus-visible:ring-app-border-strong',
      typeStyle({ role: 'control', tone: 'primary' }),
    ),
    closeButton: cn(
      'absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-app-elevated outline-none hover:bg-app-surface-2 focus-visible:ring-2 focus-visible:ring-app-border-strong',
      typeStyle({ role: 'control', tone: 'secondary' }),
    ),
  },
} satisfies NonNullable<ToasterProps['toastOptions']>

export function AppToaster() {
  const { theme } = useAppearance()

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      className="cranberri-toaster"
      duration={3600}
      visibleToasts={2}
      gap={8}
      offset={8}
      toastOptions={APP_TOAST_OPTIONS}
    />
  )
}
