import { useEffect, useState } from 'react'
import { X, Command, Keyboard, Monitor, Bot, FileJson } from 'lucide-react'
import { useSettings } from '../state/settings'
import { CODEX_MODELS, CODEX_EFFORTS, CODEX_SPEEDS, CODEX_APPROVAL_MODES } from '@/shared/codex'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

type TabValue = 'general' | 'shortcuts' | 'about'

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { settings, loading, updateSection } = useSettings()
  const [activeTab, setActiveTab] = useState<TabValue>('general')
  const [version, setVersion] = useState('…')

  useEffect(() => {
    if (!open) return
    window.cranberri.getVersion().then((v) => setVersion(v)).catch(() => setVersion('unknown'))
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex h-[540px] w-full max-w-[640px] overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-44 flex-col border-r border-app-border bg-app-bg p-2">
          <SidebarButton active={activeTab} value="general" icon={Command} label="General" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="shortcuts" icon={Keyboard} label="Shortcuts" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="about" icon={FileJson} label="About" onClick={setActiveTab} />
        </div>

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
            <span className="text-sm font-semibold">Settings</span>
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-app-surface-2" aria-label="Close settings">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="text-sm text-app-text-muted">Loading settings...</div>
            ) : (
              <div className="space-y-5">
                {activeTab === 'general' && (
                  <>
                    <Section title="Codex defaults" icon={Bot}>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Default model</span>
                        <select
                          value={settings.codex.defaultModel}
                          onChange={(e) => updateSection('codex', { defaultModel: e.target.value })}
                          className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm outline-none focus:border-app-text-muted"
                        >
                          {CODEX_MODELS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Default reasoning effort</span>
                        <select
                          value={settings.codex.defaultEffort}
                          onChange={(e) => updateSection('codex', { defaultEffort: e.target.value as typeof settings.codex.defaultEffort })}
                          className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm outline-none focus:border-app-text-muted"
                        >
                          {CODEX_EFFORTS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Default speed</span>
                        <select
                          value={settings.codex.defaultSpeed ?? 'standard'}
                          onChange={(e) => updateSection('codex', { defaultSpeed: e.target.value as typeof settings.codex.defaultSpeed })}
                          className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm outline-none focus:border-app-text-muted"
                        >
                          {CODEX_SPEEDS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Default approval mode</span>
                        <select
                          value={settings.codex.defaultApprovalMode}
                          onChange={(e) => updateSection('codex', { defaultApprovalMode: e.target.value as typeof settings.codex.defaultApprovalMode })}
                          className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm outline-none focus:border-app-text-muted"
                        >
                          {CODEX_APPROVAL_MODES.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </Section>

                    <Section title="Appearance" icon={Monitor}>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Theme</span>
                        <select
                          value={settings.appearance.theme}
                          onChange={(e) => updateSection('appearance', { theme: e.target.value as typeof settings.appearance.theme })}
                          className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm outline-none focus:border-app-text-muted"
                        >
                          <option value="dark">Dark</option>
                          <option value="light">Light (preview only)</option>
                        </select>
                      </label>
                      <p className="text-xs text-app-text-muted">Light theme is a placeholder; the app currently enforces dark mode.</p>
                    </Section>
                  </>
                )}

                {activeTab === 'shortcuts' && (
                  <Section title="Keyboard shortcuts" icon={Keyboard}>
                    <ShortcutRow keys={['⌘', ',']} description="Open settings" />
                    <ShortcutRow keys={['Enter']} description="Send message" />
                    <ShortcutRow keys={['Shift', 'Enter']} description="New line in composer" />
                  </Section>
                )}

                {activeTab === 'about' && (
                  <Section title="About Cranberri" icon={FileJson}>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-app-text-muted">Version</span>
                        <span>{version}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-app-text-muted">Codex integration</span>
                        <span>v2 app-server (stdio JSON-RPC)</span>
                      </div>
                      <p className="pt-2 text-xs text-app-text-muted">
                        Cranberri is a private, chat-first coding cockpit for local repo work.
                      </p>
                    </div>
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarButton({
  active,
  value,
  icon: Icon,
  label,
  onClick,
}: {
  active: TabValue
  value: TabValue
  icon: React.ElementType
  label: string
  onClick: (value: TabValue) => void
}) {
  const isActive = active === value
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        isActive ? 'bg-app-surface-2 text-app-text' : 'text-app-text-muted hover:bg-app-surface-2/50'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-app-text-muted">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key) => (
          <kbd key={key} className="rounded bg-app-surface-2 px-1.5 py-0.5 text-xs text-app-text-muted">{key}</kbd>
        ))}
      </div>
    </div>
  )
}
