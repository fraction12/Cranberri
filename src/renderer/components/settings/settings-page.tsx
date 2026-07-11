import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-[620px] space-y-7">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-app-text">{title}</h2>
          {description && <p className="mt-1 text-sm text-app-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold text-app-text">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-app-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="space-y-0.5">{children}</div>
}

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-5 rounded-md px-1 py-2">
      <div className="min-w-0">
        <div className="text-sm text-app-text">{label}</div>
        {description && <div className="mt-0.5 max-w-[390px] text-caption text-app-text-muted">{description}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

export function SettingsDisclosure({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string
  description?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-2.5 text-sm text-app-text marker:hidden hover:bg-app-bg">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-app-text-muted transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">{title}</span>
        {description && <span className="shrink-0 text-caption text-app-text-muted">{description}</span>}
      </summary>
      <div className="pb-3 pl-5 pr-1">{children}</div>
    </details>
  )
}
