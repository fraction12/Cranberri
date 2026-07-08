import { Toaster } from 'sonner'

export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      className="cranberri-toaster"
      duration={1800}
      toastOptions={{
        classNames: {
          toast: 'border border-app-border bg-app-surface text-app-text shadow-2xl',
          title: 'text-app-text',
          description: 'text-app-text-muted',
          actionButton: 'bg-app-accent text-black',
          cancelButton: 'bg-app-surface-2 text-app-text',
        },
      }}
    />
  )
}
