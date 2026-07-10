import { useEffect, useState } from 'react'
import { X, Command, Keyboard, Palette, Bot, FileJson, RotateCw, Download, AlertCircle, CheckCircle2, PackageOpen, Activity, PlugZap, Wrench } from 'lucide-react'
import { useSettings } from '../state/settings'
import { useUpdate } from '../state/update'
import { DiagnosticsSection } from './DiagnosticsSection'
import { CodexResourcesSection } from './CodexResourcesSection'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { ToolsSettingsPane } from './settings/ToolsSettingsPane'
import {
  CODEX_MODELS,
  CODEX_APPROVAL_MODES,
  getCodexEffortsForModel,
  getCodexSpeedsForModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
  type CodexConnectionStatus,
} from '@/shared/codex'
import type { UpdateInfo } from '@/shared/update'
import type { AppSettings } from '@/shared/settings'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  initialTab?: SettingsTabValue
}

export type SettingsTabValue = 'general' | 'appearance' | 'tools' | 'apps' | 'updates' | 'diagnostics' | 'shortcuts' | 'about'

function codexConnectionActionLabel(status: CodexConnectionStatus | null, busy: boolean): string {
  if (busy) return status?.updateRequired ? 'Updating…' : 'Connecting…'
  if (status?.updateRequired) return 'Update Codex'
  if (status?.authenticated) return 'Connected'
  if (status?.installed === false) return 'Install & Connect'
  return 'Connect Codex'
}

export function SettingsDialog({ open, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings, loading, updateSection } = useSettings()
  const update = useUpdate()
  const [activeTab, setActiveTab] = useState<SettingsTabValue>(initialTab)
  const [version, setVersion] = useState('…')
  const [codexStatus, setCodexStatus] = useState<CodexConnectionStatus | null>(null)
  const [connectingCodex, setConnectingCodex] = useState(false)
  const [codexError, setCodexError] = useState<string | null>(null)
  const defaultEfforts = getCodexEffortsForModel(settings.codex.defaultModel)
  const defaultSpeeds = getCodexSpeedsForModel(settings.codex.defaultModel)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    window.cranberri.getVersion().then((v) => setVersion(v)).catch(() => setVersion('unknown'))
    window.cranberri.codex.getConnectionStatus()
      .then((status) => {
        setCodexStatus(status)
        setCodexError(null)
      })
      .catch((err) => setCodexError(err instanceof Error ? err.message : 'Failed to check Codex connection'))
  }, [initialTab, open])

  const connectCodex = async () => {
    setConnectingCodex(true)
    setCodexError(null)
    try {
      const status = await window.cranberri.codex.connect()
      setCodexStatus(status)
    } catch (err) {
      setCodexError(err instanceof Error ? err.message : 'Failed to connect Codex')
      window.cranberri.codex.getConnectionStatus().then(setCodexStatus).catch(() => undefined)
    } finally {
      setConnectingCodex(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[var(--app-overlay)] p-6" onClick={onClose}>
      <div className="flex h-[560px] w-full max-w-[720px] overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-44 shrink-0 flex-col border-r border-app-border bg-app-bg p-2">
          <SidebarButton active={activeTab} value="general" icon={Command} label="General" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="appearance" icon={Palette} label="Appearance" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="tools" icon={Wrench} label="Tools" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="apps" icon={PlugZap} label="Apps" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="updates" icon={Download} label="Updates" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="diagnostics" icon={Activity} label="Diagnostics" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="shortcuts" icon={Keyboard} label="Shortcuts" onClick={setActiveTab} />
          <SidebarButton active={activeTab} value="about" icon={FileJson} label="About" onClick={setActiveTab} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
            <span className="text-sm font-semibold">Settings</span>
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-app-surface-2" aria-label="Close settings">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {loading ? (
              <div className="text-sm text-app-text-muted">Loading settings...</div>
            ) : (
              <div className="space-y-5">
                {activeTab === 'general' && (
                  <>
                    <Section title="Codex defaults" icon={Bot}>
                      <div className="rounded-xl border border-app-border bg-app-bg p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-app-text">Codex connection</div>
                            <div className="mt-1 truncate text-xs text-app-text-muted" title={codexError ?? codexStatus?.detail}>
                              {codexError ?? codexStatus?.detail ?? 'Checking Codex…'}
                            </div>
                            {codexStatus?.cliPath && <div className="mt-1 truncate font-mono text-micro text-app-text-muted" title={codexStatus.cliPath}>{codexStatus.cliPath}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() => void connectCodex()}
                            disabled={connectingCodex || (codexStatus?.authenticated === true && !codexStatus.updateRequired)}
                            className="shrink-0 rounded-lg bg-app-accent px-3 py-2 text-xs font-medium text-app-accent-contrast hover:bg-app-accent/90 disabled:cursor-not-allowed disabled:bg-app-surface-2 disabled:text-app-text-muted"
                          >
                            {codexConnectionActionLabel(codexStatus, connectingCodex)}
                          </button>
                        </div>
                        {!codexStatus?.installed && (
                          <p className="mt-2 text-caption text-app-text-muted">Cranberri will install the Codex CLI with npm, then launch Codex device auth.</p>
                        )}
                      </div>
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-app-text-muted">Default model</span>
                        <select
                          value={settings.codex.defaultModel}
                          onChange={(e) => {
                            const defaultModel = e.target.value
                            void updateSection('codex', {
                              defaultModel,
                              defaultEffort: normalizeCodexReasoningEffort(
                                defaultModel,
                                settings.codex.defaultEffort,
                              ),
                              defaultSpeed: normalizeCodexSpeed(
                                defaultModel,
                                settings.codex.defaultSpeed,
                              ),
                            })
                          }}
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
                          {defaultEfforts.map((option) => (
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
                          {defaultSpeeds.map((option) => (
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

                  </>
                )}

                {activeTab === 'appearance' && <AppearanceSettings />}

                {activeTab === 'tools' && <ToolsSettingsPane onNavigate={setActiveTab} />}

                {activeTab === 'shortcuts' && (
                  <Section title="Keyboard shortcuts" icon={Keyboard}>
                    <ShortcutRow keys={['⌘', ',']} description="Open settings" />
                    <ShortcutRow keys={['Enter']} description="Send message" />
                    <ShortcutRow keys={['Shift', 'Enter']} description="New line in composer" />
                  </Section>
                )}

                {activeTab === 'updates' && (
                  <UpdatesSection update={update} settings={settings} updateSection={updateSection} />
                )}

                {activeTab === 'apps' && <CodexResourcesSection />}

                {activeTab === 'diagnostics' && <DiagnosticsSection />}

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
  active: SettingsTabValue
  value: SettingsTabValue
  icon: React.ElementType
  label: string
  onClick: (value: SettingsTabValue) => void
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
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-app-text-muted">
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

function UpdatesSection({ update, settings, updateSection }: {
  update: ReturnType<typeof useUpdate>
  settings: AppSettings
  updateSection: <Section extends keyof AppSettings>(section: Section, values: Partial<AppSettings[Section]>) => Promise<void>
}) {
  const status = update.status
  const progress = update.progress
  const pendingResult = update.pendingResult
  const checking = update.checking
  const installing = update.installing

  const commit = (hash?: string | null) => (hash ? hash.slice(0, 7) : 'unknown')

  const pickBetaRepo = async () => {
    const repoPath = await window.cranberri.repos.pickDirectory()
    if (!repoPath) return
    await updateSection('updater', { sourceRepoPath: repoPath })
  }

  return (
    <Section title="Updates" icon={PackageOpen}>
      <div className="space-y-3">
        <div className="rounded-xl border border-app-border bg-app-bg p-3">
          <div className="mb-2 text-xs font-medium text-app-text-muted">Update channel</div>
          <div className="grid grid-cols-2 gap-2">
            {(['stable', 'beta'] as const).map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => updateSection('updater', { channel })}
                className={`rounded-lg border px-3 py-2 text-left text-xs ${settings.updater.channel === channel ? 'border-app-accent bg-app-accent/10 text-app-text' : 'border-app-border bg-app-surface-2 text-app-text-muted hover:bg-app-border'}`}
              >
                <div className="font-medium capitalize">{channel}</div>
                <div className="mt-1 text-micro leading-snug opacity-80">
                  {channel === 'stable' ? 'GitHub Actions release artifacts.' : 'Build latest origin/main from local source.'}
                </div>
              </button>
            ))}
          </div>
          {settings.updater.channel === 'beta' && (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1.5 block text-xs text-app-text-muted">Cranberri source repo path</span>
                <input
                  value={settings.updater.sourceRepoPath ?? ''}
                  onChange={(event) => updateSection('updater', { sourceRepoPath: event.target.value })}
                  placeholder="/Users/you/Projects/Cranberri"
                  className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 font-mono text-xs outline-none focus:border-app-text-muted"
                />
              </label>
              <button
                type="button"
                onClick={() => void pickBetaRepo()}
                className="rounded-lg bg-app-surface-2 px-3 py-2 text-xs font-medium hover:bg-app-surface-2/80"
              >
                Choose repo…
              </button>
              <p className="text-caption text-app-text-muted">Beta requires a local clone. Cranberri fetches origin/main, builds it, packages it, then installs that app.</p>
            </div>
          )}
        </div>

        <StatusRow icon={status?.status === 'upToDate' ? CheckCircle2 : status?.status === 'updateAvailable' ? Download : status?.status === 'failed' ? AlertCircle : RotateCw} label="Status">
          <span className={status?.status === 'updateAvailable' ? 'text-app-info' : status?.status === 'failed' ? 'text-app-danger' : ''}>
            {formatUpdateStatus(status)}
          </span>
        </StatusRow>

        {status?.currentCommit && (
          <StatusRow label="Running commit">{commit(status.currentCommit)}</StatusRow>
        )}
        {status?.latestCommit && (
          <StatusRow label={settings.updater.channel === 'beta' ? 'Latest origin/main' : 'Latest release'}>{commit(status.latestCommit)}</StatusRow>
        )}
        {status?.commitsBehind !== undefined && status.commitsBehind !== null && (
          <StatusRow label="Commits behind">{status.commitsBehind}</StatusRow>
        )}

        {status?.blockedReason && (
          <div className="rounded-lg border border-app-border bg-app-bg p-3 text-xs text-app-text-muted">
            {status.blockedMessage}
          </div>
        )}

        {status?.failureMessage && (
          <div className="rounded-lg border border-app-danger/30 bg-app-danger/10 p-3 text-xs text-app-text-muted">
            <div className="font-medium text-app-danger">Update failed</div>
            <div className="mt-1">{status.failureMessage}</div>
            {status.logPath && (
              <div className="mt-1 font-mono text-micro opacity-80">{status.logPath}</div>
            )}
          </div>
        )}

        {pendingResult && !status?.failureMessage && (
          <div className="rounded-lg border border-app-border bg-app-bg p-3 text-xs text-app-text-muted">
            <div className="font-medium text-app-text">Install result</div>
            <div className="mt-1">{pendingResult.message ?? (pendingResult.success ? 'Success' : 'Failed')}</div>
            <button
              type="button"
              onClick={() => void update.clearResult()}
              className="mt-2 rounded bg-app-surface-2 px-2 py-1 text-caption hover:bg-app-surface-2/80"
            >
              Dismiss
            </button>
          </div>
        )}

        {progress && status?.status !== 'upToDate' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-app-text-muted">
              <span>{progress.message}</span>
              {progress.percent !== null && <span>{progress.percent}%</span>}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-surface-2">
              <div
                className="h-full rounded-full bg-app-accent transition-all"
                style={{ width: `${progress.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void update.check()}
            disabled={checking || installing}
            className="rounded-lg bg-app-surface-2 px-3 py-2 text-xs font-medium hover:bg-app-surface-2/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {status?.status === 'updateAvailable' && (
            <button
              type="button"
              onClick={() => void update.install()}
              disabled={checking || installing}
              className="rounded-lg bg-app-accent px-3 py-2 text-xs font-medium text-app-accent-contrast hover:bg-app-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? 'Installing…' : settings.updater.channel === 'beta' ? 'Build & install beta' : 'Download & install update'}
            </button>
          )}
        </div>
      </div>
    </Section>
  )
}

function formatUpdateStatus(status: UpdateInfo | null): string {
  if (!status) return 'Unknown'
  switch (status.status) {
    case 'unknown': return 'Unknown'
    case 'checking': return 'Checking for updates…'
    case 'upToDate': return `Up to date (${status.currentCommit?.slice(0, 7) ?? 'unknown'})`
    case 'updateAvailable': return status.commitsBehind === null ? 'Update available' : `${status.commitsBehind} commit${status.commitsBehind === 1 ? '' : 's'} behind`
    case 'building': return 'Preparing update…'
    case 'readyToInstall': return 'Update ready to install'
    case 'installing': return 'Installing and relaunching…'
    case 'blocked': return status.blockedMessage || 'Update blocked'
    case 'failed': return status.failureMessage || 'Update failed'
    default: return 'Unknown'
  }
}

function StatusRow({ label, children, icon: Icon }: { label: string; children?: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-app-text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span>{label}</span>
      </div>
      <div className="font-medium">{children}</div>
    </div>
  )
}
