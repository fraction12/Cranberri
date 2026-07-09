import { Toaster } from 'sonner'
import { useAppearance } from '../state/appearance-context'

export function AppToaster() {
  const { theme } = useAppearance()

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      className="cranberri-toaster"
      duration={1800}
      toastOptions={{
        classNames: {
          toast: 'border border-app-border bg-app-surface text-app-text shadow-2xl',
          title: 'text-app-text',
          description: 'text-app-text-muted',
          actionButton: 'bg-app-accent text-app-accent-contrast',
          cancelButton: 'bg-app-surface-2 text-app-text',
        },
      }}
    />
  )
}
