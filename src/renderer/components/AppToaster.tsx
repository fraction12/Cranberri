import { Toaster } from 'sonner'
import { useAppearance } from '../state/appearance-context'

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
      toastOptions={{
        classNames: {
          toast: 'rounded-lg border-0 bg-app-elevated text-app-text shadow-xl ring-1 ring-app-border/80',
          title: 'text-sm font-medium text-app-text',
          description: 'text-xs text-app-text-muted',
          actionButton: 'rounded-md bg-app-accent text-app-accent-contrast',
          cancelButton: 'rounded-md bg-app-surface-2 text-app-text',
        },
      }}
    />
  )
}
