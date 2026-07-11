import { useEffect, useRef, useState } from 'react'
import { Activity, Command, Download, FileText, Keyboard, Palette, PlugZap, Wrench, X } from 'lucide-react'
import { useSettings } from '../state/settings'
import { useUpdate } from '../state/update'
import { CodexResourcesSection } from './CodexResourcesSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { SettingsList, SettingsPage, SettingsRow } from './settings/settings-page'
import { ToolsSettingsPane } from './settings/tools-settings-pane'
import { UpdatesSettings } from './settings/UpdatesSettings'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  initialTab?: SettingsTabValue
}

export type SettingsTabValue = 'general' | 'appearance' | 'tools' | 'apps' | 'updates' | 'diagnostics' | 'shortcuts' | 'about'

const TABS: Array<{ value: SettingsTabValue; label: string; icon: React.ElementType }> = [
  { value: 'general', label: 'General', icon: Command },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'tools', label: 'Tools', icon: Wrench },
  { value: 'apps', label: 'Extensions', icon: PlugZap },
  { value: 'updates', label: 'Updates', icon: Download },
  { value: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { value: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { value: 'about', label: 'About', icon: FileText },
]

export function SettingsDialog({ open, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings, loading, updateSection } = useSettings()
  const update = useUpdate()
  const [activeTab, setActiveTab] = useState<SettingsTabValue>(initialTab)
  const [version, setVersion] = useState('...')
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    window.cranberri.getVersion().then(setVersion).catch(() => setVersion('Unavailable'))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [initialTab, onClose, open])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeTab])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[var(--app-overlay)] p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="flex h-[min(640px,calc(100vh-48px))] w-full max-w-[800px] flex-col overflow-hidden rounded-lg border border-app-border bg-app-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center justify-between px-4">
          <h1 id="settings-dialog-title" className="text-sm font-semibold text-app-text">Settings</h1>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-app-text-muted hover:bg-app-surface-2 hover:text-app-text" aria-label="Close settings">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 bg-app-bg p-2" aria-label="Settings pages">
            {TABS.map((tab) => (
              <SidebarButton key={tab.value} active={activeTab === tab.value} {...tab} onClick={setActiveTab} />
            ))}
          </nav>

          <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto p-5" aria-live="polite">
            {loading ? <div className="text-sm text-app-text-muted">Loading settings...</div> : (
              <SettingsContent
                activeTab={activeTab}
                version={version}
                update={update}
                settings={settings}
                updateSection={updateSection}
                onNavigate={setActiveTab}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function SettingsContent({ activeTab, version, update, settings, updateSection, onNavigate }: {
  activeTab: SettingsTabValue
  version: string
  update: ReturnType<typeof useUpdate>
  settings: ReturnType<typeof useSettings>['settings']
  updateSection: ReturnType<typeof useSettings>['updateSection']
  onNavigate: (tab: SettingsTabValue) => void
}) {
  if (activeTab === 'general') return <GeneralSettings />
  if (activeTab === 'appearance') return <AppearanceSettings />
  if (activeTab === 'tools') return <ToolsSettingsPane onNavigate={onNavigate} />
  if (activeTab === 'apps') return <CodexResourcesSection />
  if (activeTab === 'updates') return <UpdatesSettings update={update} settings={settings} updateSection={updateSection} />
  if (activeTab === 'diagnostics') return <DiagnosticsSection />
  if (activeTab === 'shortcuts') return <ShortcutsSettings />
  return <AboutSettings version={version} />
}

function SidebarButton({ active, value, icon: Icon, label, onClick }: {
  active: boolean
  value: SettingsTabValue
  icon: React.ElementType
  label: string
  onClick: (value: SettingsTabValue) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${active ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted hover:bg-app-surface-2/60 hover:text-app-text'}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function ShortcutsSettings() {
  return (
    <SettingsPage title="Shortcuts" description="Keyboard commands available throughout Cranberri.">
      <SettingsList>
        <ShortcutRow label="Open settings" keys={['⌘', ',']} />
        <ShortcutRow label="Send message" keys={['Enter']} />
        <ShortcutRow label="New line in composer" keys={['Shift', 'Enter']} />
      </SettingsList>
    </SettingsPage>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <SettingsRow label={label}>
      <div className="flex items-center gap-1">
        {keys.map((key) => <kbd key={key} className="rounded bg-app-surface-2 px-1.5 py-0.5 text-xs text-app-text-muted">{key}</kbd>)}
      </div>
    </SettingsRow>
  )
}

function AboutSettings({ version }: { version: string }) {
  return (
    <SettingsPage title="About" description="Cranberri is a private, chat-first workspace for local repo work.">
      <SettingsList>
        <SettingsRow label="Version"><span className="text-sm text-app-text">{version}</span></SettingsRow>
        <SettingsRow label="Data" description="Repos, settings, and task history stay on this Mac."><span className="text-xs text-app-text-muted">Local</span></SettingsRow>
      </SettingsList>
    </SettingsPage>
  )
}
